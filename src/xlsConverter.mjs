import fs from 'fs';
import path, { join } from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import axios from 'axios';
import xlsx from 'xlsx';
import pLimit from 'p-limit';

// Emulate __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamically resolve the app's base path
const appPath = process.env.NODE_ENV === 'production'
    ? process.resourcesPath
    : __dirname;

// Define the log file path
const logFilePath = path.join(appPath, 'app.log');

// Reusable logToFile function
export function logToFile(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    try {
        fs.appendFileSync(logFilePath, logMessage, 'utf-8');
        console.log(`[INFO] Logged to file: ${message}`);
    } catch (error) {
        console.error(`[ERROR] Failed to write to log file: ${error.message}`);
    }
}

// Concurrency limit
const limit = pLimit(100); // Limit to 50 concurrent requests

// Sanitize folder names
function sanitizeFolderName(name) {
    return name.replace(/[<>:"/\\|?*]/g, '');
}

// Ensure the ./db/ directory exists
function ensureDbDirectory() {
    const dbDir = join(__dirname, 'db');
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    return dbDir;
}

// Setup SQLite database
function setupDatabase(dbPath) {
    logToFile('[DEBUG] Setting up database at:', dbPath);

    const db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            logToFile('[ERROR] Failed to create database:', err.message);
            throw new Error('Failed to create database.');
        } else {
            logToFile('[DEBUG] Database successfully created at:', dbPath);
        }
    });

    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS Claims (
                File_Name TEXT,
                Alt_File_Name TEXT,
                File_Claim_ID TEXT PRIMARY KEY,
                File_URL TEXT,
                Alt_File_URL TEXT,
                File_Size INTEGER,
                Dev_Name TEXT,
                Dev_Claim_ID TEXT,
                Release_Date TEXT,
                Media_Type TEXT,
                Description TEXT,
                Thumbnail_URL TEXT,
                File_Download_Name TEXT
            )
        `, (err) => {
            if (err) {
                logToFile('[ERROR] Failed to create table Claims:', err.message);
                throw new Error('Failed to create Claims table.');
            } else {
                logToFile('[DEBUG] Claims table successfully created or already exists.');
            }
        });
    });

    return db;
}

// Read Odysee links and metadata from an ODS file
function readOdyseeLinksAndDate(fileName, sheetIndex) {
    const workbook = xlsx.readFile(fileName, { raw: true, cellDates: true });
    const sheetName = workbook.SheetNames[sheetIndex - 1];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    // Get links from Column B
    const links = rows.slice(1).map(row => row[1]?.trim()).filter(Boolean);

    // Get the newest date from Column K
    const dateCells = rows.slice(1).map(row => row[10]).filter(Boolean); // Column K (index 10)
    const newestDate = dateCells
        .map(cell => (cell instanceof Date ? cell : new Date(cell))) // Convert to Date objects
        .filter(date => !isNaN(date)) // Filter valid dates
        .reduce((latest, current) => (current > latest ? current : latest), new Date(0)); // Find the newest date

    const dbDate = newestDate.toISOString().slice(0, 10).replace(/-/g, ''); // Format as YYYYMMDD

    return { links, dbDate };
}

// Convert Odysee URL to LBRY format
function convertToLbryUrl(odyseeUrl) {
    if (!odyseeUrl.startsWith('https://odysee.com/')) return null;
    return odyseeUrl.replace('https://odysee.com/', 'lbry://');
}

// Resolve Claim ID for a single LBRY URL
async function resolveClaimId(lbryUrl) {
    try {
        const response = await axios.post('https://api.lbry.tv/api/v1/proxy', {
            method: 'resolve',
            params: { urls: [lbryUrl] },
        });
        const claimId = response.data.result[lbryUrl]?.claim_id;
        if (!claimId) throw new Error('No claim_id found');
        return claimId;
    } catch (error) {
        logToFile(`Error resolving ${lbryUrl}: ${error.message}`);
        return null;
    }
}

// Fetch claims for a developer
async function fetchClaimsForDeveloper(devName, devClaimId) {
    devName = devName.replace(/^\/+/, ''); // Remove leading slashes
    let page = 1;
    const claims = [];
    while (true) {
        try {
            const response = await axios.post('https://api.lbry.tv/api/v1/proxy', {
                method: 'claim_search',
                params: {
                    channel_id: devClaimId,
                    page_size: 50,
                    page,
                    order_by: ['release_time'],
                },
            });
            const items = response.data.result.items || [];
            if (!items.length) break;

            for (const item of items) {
                const fileSize = item.value?.source?.size || 0;
                if (fileSize === 0) continue; // Skip invalid items

                // Validate release_time
                let releaseDate = 'Unknown';
                try {
                    if (item.value?.release_time) {
                        releaseDate = new Date(item.value.release_time * 1000).toISOString().split('T')[0];
                    }
                } catch (err) {
                    logToFile(`[WARN] Invalid release_time for claim_id ${item.claim_id}: ${item.value?.release_time}`);
                }

                // Extract Dev_Name from Alt_File_URL
                const Alt_File_URL = item.canonical_url || '';
                const extractedDevName = extractDevName(Alt_File_URL);

                claims.push({
                    File_Name: item.value?.title || '',
                    Alt_File_Name: sanitizeFolderName(item.value?.title || ''),
                    File_Claim_ID: item.claim_id,
                    File_URL: item.permanent_url,
                    Alt_File_URL,
                    File_Size: fileSize,
                    Dev_Name: extractedDevName, // Use extracted Dev_Name
                    Dev_Claim_ID: devClaimId,
                    Release_Date: releaseDate, // Use validated or default value
                    Media_Type: item.value?.source?.media_type || '',
                    Description: item.value?.description || '',
                    Thumbnail_URL: item.value?.thumbnail?.url || '',
                    File_Download_Name: item.value?.source?.name || '',
                });
            }
            page++;
        } catch (error) {
            logToFile(`Error fetching claims for ${devClaimId}: ${error.message}`);
            break;
        }
    }
    return claims;
}

// Main process
async function populateDatabase(excelFile, sheetIndex, libraryFolder) {
    try {
        // Existing database population logic...
        const { links, dbDate } = readOdyseeLinksAndDate(excelFile, sheetIndex);
        const dbName = `odysee_${dbDate}.db`;
        const dbPath = path.join(libraryFolder, dbName);

        logToFile('[DEBUG] Database path constructed:', dbPath);

        const db = setupDatabase(dbPath);

        // Process developer claims
        logToFile('[DEBUG] Resolving claims for developer links...');
        const resolveTasks = links.map(link => {
            const lbryUrl = convertToLbryUrl(link); // Convert link to LBRY URL
            if (!lbryUrl) return null; // Skip invalid links

            const devName = lbryUrl.split(':')[1];
            return limit(() => resolveClaimId(lbryUrl).then(claimId => ({ devName, claimId })));
        }).filter(Boolean); // Remove null tasks

        const resolved = (await Promise.all(resolveTasks)).filter(result => result?.claimId);

        // Fetch claims for developers
        logToFile('[DEBUG] Fetching claims for developers...');
        const claimTasks = resolved.map(({ devName, claimId }) =>
            limit(() => fetchClaimsForDeveloper(devName, claimId))
        );

        const developerClaims = (await Promise.all(claimTasks)).flat();

        // Process individual claims from Sheet 5
        logToFile('[DEBUG] Processing individual claims from Sheet 5...');
        const individualClaims = await processIndividualClaims(excelFile);

        // Combine all claims (developer + individual)
        const allClaims = [...developerClaims, ...individualClaims];

        // Insert all claims into the database
        await new Promise((resolve, reject) => {
            db.serialize(() => {
                const insertStmt = db.prepare(`
                    INSERT OR REPLACE INTO Claims (
                        File_Name, Alt_File_Name, File_Claim_ID, File_URL, Alt_File_URL,
                        File_Size, Dev_Name, Dev_Claim_ID, Release_Date, Media_Type,
                        Description, Thumbnail_URL, File_Download_Name
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                allClaims.forEach(claim => {
                    logToFile(`[DEBUG] Claim being inserted: ${JSON.stringify(claim, null, 2)}`);
                    insertStmt.run(
                        claim.File_Name,
                        sanitizeFolderName(claim.File_Name),
                        claim.File_Claim_ID,
                        claim.File_URL,
                        claim.Alt_File_URL || null,
                        claim.File_Size || 0,
                        claim.Dev_Name,
                        claim.Dev_Claim_ID || null,
                        claim.Release_Date || 'Unknown',
                        claim.Media_Type || '',
                        claim.Description || '',
                        claim.Thumbnail_URL || '',
                        claim.File_Download_Name || '',
                        (err) => {
                            if (err) {
                                logToFile('[ERROR] Failed to insert claim:', err.message);
                                reject(err);
                            }
                        }
                    );
                });

                insertStmt.finalize();

                db.close(() => {
                    logToFile(`[INFO] Database population completed: ${dbPath}`);
                    resolve();
                });
            });
        });

        // Perform cleanup
        await cleanupDatabase(dbPath);

        return dbPath; // Return the path to the created database
    } catch (err) {
        logToFile('[ERROR] Failed to populate database:', err.message);
        throw err;
    }
}

// Read individual claims from Sheet 5
function readIndividualClaims(fileName) {
    const workbook = xlsx.readFile(fileName, { raw: true, cellDates: true });
    const sheetName = workbook.SheetNames[4]; // Sheet 5 (0-based index)
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    // Extract claims: Column A (File_Name), Column B (Odysee URL)
    const claims = rows.slice(1).map(row => ({
        File_Name: row[0]?.trim() || 'Unknown File',
        File_URL: row[1]?.trim(),
        Dev_Name: 'AnonymousDevs',
    })).filter(claim => claim.File_Name && claim.File_URL);

    return claims;
}

// Fetch metadata for a single claim by claim_id
async function fetchMetadataForIndividualClaim(lbryUrl) {
    try {
        const response = await axios.post('https://api.lbry.tv/api/v1/proxy', {
            method: 'resolve',
            params: { urls: [lbryUrl] },
        });

        const metadata = response.data.result[lbryUrl];

        if (!metadata) {
            logToFile(`[WARN] No metadata found for LBRY URL: ${lbryUrl}`);
            return null;
        }

        // Extract relevant fields
        const {
            value = {},
            permanent_url: File_URL,
            canonical_url: Alt_File_URL,
            claim_id: File_Claim_ID,
        } = metadata;

        // Generate Dev_Name based on Alt_File_URL
        const Dev_Name = extractDevName(Alt_File_URL);

        return {
            File_Name: value.title || 'Unknown File',
            Alt_File_Name: sanitizeFolderName(value.title || 'Unknown File'),
            File_Claim_ID,
            File_URL,
            Alt_File_URL,
            File_Size: value.source?.size || 0,
            Dev_Name, // Use extracted Dev_Name
            Dev_Claim_ID: null,
            Release_Date: value.release_time
                ? new Date(value.release_time * 1000).toISOString().split('T')[0]
                : 'Unknown',
            Media_Type: value.source?.media_type || '',
            Description: value.description || '',
            Thumbnail_URL: value.thumbnail?.url || '',
            File_Download_Name: value.source?.name || '',
        };
    } catch (error) {
        logToFile(`[ERROR] Failed to fetch metadata for LBRY URL ${lbryUrl}: ${error.message}`);
        return null;
    }
}

async function processIndividualClaims(excelFile) {
    logToFile('[DEBUG] Reading individual claims from Sheet 5...');
    const individualClaims = readIndividualClaims(excelFile);

    // Fetch metadata for each claim
    const claimTasks = individualClaims.map((claim) => {
        const lbryUrl = convertToLbryUrl(claim.File_URL);
        if (!lbryUrl) return null;

        return limit(() => fetchMetadataForIndividualClaim(lbryUrl));
    }).filter(Boolean); // Filter out null tasks

    const resolvedClaims = await Promise.all(claimTasks);

    // Filter out failed or null metadata
    const validClaims = resolvedClaims.filter((claim) => claim !== null);

    logToFile(`[DEBUG] Successfully processed ${validClaims.length} individual claims.`);
    return validClaims;
}

async function cleanupDatabase(dbPath) {
    const db = new sqlite3.Database(dbPath);

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            logToFile(`[DEBUG] Starting cleanup for database: ${dbPath}`);

            // Handle invalid Release_Date values
            db.run(`
                UPDATE Claims
                SET Release_Date = '0000-00-00'
                WHERE Release_Date IS NULL OR Release_Date = 'Unknown'
            `, (err) => {
                if (err) {
                    logToFile(`[ERROR] Failed to clean invalid Release_Date values: ${err.message}`);
                    reject(err); // Reject the promise
                    return;
                }

                logToFile(`[INFO] Invalid Release_Date values cleaned.`);

                // Perform optimized cleanup
                db.run(`
                    DELETE FROM Claims
                    WHERE rowid NOT IN (
                        SELECT rowid
                        FROM Claims c1
                        WHERE Release_Date = (
                            SELECT MAX(Release_Date)
                            FROM Claims c2
                            WHERE c1.File_Claim_ID = c2.File_Claim_ID
                        )
                    )
                `, (err) => {
                    if (err) {
                        logToFile(`[ERROR] Optimized cleanup query failed: ${err.message}`);
                        reject(err); // Reject the promise
                        return;
                    }

                    logToFile(`[INFO] Optimized cleanup query completed successfully.`);
                });
            });
        });

        // Close the database after all queries are completed
        db.close((err) => {
            if (err) {
                logToFile(`[ERROR] Failed to close database during cleanup: ${err.message}`);
                reject(err); // Reject the promise
            } else {
                logToFile(`[INFO] Database cleanup completed successfully.`);
                resolve(); // Resolve the promise
            }
        });
    });
}

// Extract Dev_Name from Alt_File_URL
function extractDevName(altFileUrl) {
    if (!altFileUrl) return 'UnknownDev';

    // Match the part inside the forward slashes and replace "#" with "_"
    const match = altFileUrl.match(/lbry:\/\/(@[^\/]+)/);
    if (match && match[1]) {
        return match[1].replace(/#/g, '_');
    }

    return 'UnknownDev'; // Default if no match is found
}
   
// Export the function so it can be called from another script
export { populateDatabase };
