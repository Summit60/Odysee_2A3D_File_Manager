import fs from 'fs';
import path, { join } from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';
import axios from 'axios';
import xls from 'xlsjs';
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

// Read Odysee links and metadata from an XLS file
function readOdyseeLinksAndDate(fileName, sheetIndex) {
    const workbook = xls.readFile(fileName);
    const sheetName = workbook.SheetNames[sheetIndex - 1];
    const sheet = workbook.Sheets[sheetName];
    const rows = xls.utils.sheet_to_json(sheet, { header: 1 });

    // Get links from Column B
    const links = rows.slice(1).map(row => row[1]?.trim()).filter(Boolean);

    // Get date from Column K, Row 2
    const dateCell = rows[1][10];
    const dbDate = typeof dateCell === 'number'
        ? new Date((dateCell - 25569) * 86400 * 1000).toISOString().slice(0, 10).replace(/-/g, '')
        : dateCell?.replace(/-/g, '');
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

                claims.push({
                    File_Name: item.value?.title || '',
                    Alt_File_Name: sanitizeFolderName(item.value?.title || ''),
                    File_Claim_ID: item.claim_id,
                    File_URL: item.permanent_url,
                    Alt_File_URL: item.canonical_url,
                    File_Size: fileSize,
                    Dev_Name: devName,
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
        const { links, dbDate } = readOdyseeLinksAndDate(excelFile, sheetIndex);
        const dbName = `odysee_${dbDate}.db`;
        const dbPath = path.join(libraryFolder, dbName);

        logToFile('[DEBUG] Database path constructed:', dbPath);

        const db = setupDatabase(dbPath);

        // Check if links are valid
        if (!links || links.length === 0) {
            logToFile('[ERROR] No links found in the Excel file.');
            db.close();
            throw new Error('No links found in the Excel file.');
        }

        // Fetch claims for each link
        logToFile('[DEBUG] Resolving claims for links...');
        const resolveTasks = links.map(link => {
            const lbryUrl = convertToLbryUrl(link); // Convert link to LBRY URL
            if (!lbryUrl) return null; // Skip invalid links

            const devName = lbryUrl.split(':')[1];
            return limit(() => resolveClaimId(lbryUrl).then(claimId => ({ devName, claimId })));
        }).filter(Boolean); // Remove null tasks

        // Wait for all links to resolve
        const resolved = (await Promise.all(resolveTasks)).filter(result => result?.claimId);

        // Fetch claims for developers
        logToFile('[DEBUG] Fetching claims for developers...');
        const claimTasks = resolved.map(({ devName, claimId }) =>
            limit(() => fetchClaimsForDeveloper(devName, claimId))
        );

        const allClaims = (await Promise.all(claimTasks)).flat(); // Combine all claims into a single array
        logToFile('[DEBUG] All claims resolved:', allClaims);

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
                    logToFile('[DEBUG] Inserting claim into database:', claim);

                    insertStmt.run(
                        claim.File_Name,
                        claim.Alt_File_Name,
                        claim.File_Claim_ID,
                        claim.File_URL,
                        claim.Alt_File_URL,
                        claim.File_Size,
                        claim.Dev_Name,
                        claim.Dev_Claim_ID,
                        claim.Release_Date,
                        claim.Media_Type,
                        claim.Description,
                        claim.Thumbnail_URL,
                        claim.File_Download_Name,
                        (err) => {
                            if (err) {
                                logToFile('[ERROR] Failed to insert claim:', err.message);
                                reject(err); // Reject if an error occurs during insertion
                            }
                        }
                    );
                });

                insertStmt.finalize();

                db.close(() => {
                    logToFile(`Database created: ${dbPath}`);
                    resolve(); // Resolve when database operations complete
                });
            });
        });

        return dbPath; // Return the path to the created database
    } catch (err) {
        logToFile('[ERROR] Failed to populate database:', err.message);
        throw err; // Rethrow the error to be handled by the caller
    }
}
   
// Export the function so it can be called from another script
export { populateDatabase };
