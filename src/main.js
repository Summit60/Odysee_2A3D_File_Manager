//////////////Imports and Constants//////////////
const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { shell } = require('electron');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const axios = require('axios')
const os = require('os');

const getAppPath = () => app.isPackaged
    ? process.resourcesPath // In packaged app
    : __dirname; // In development

const defaultConfig = {
    libraryFolder: null,
    maxConcurrentDownloads: 5,
};

const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'config.json');
const currentVersion = app.getVersion();
const appPath = getAppPath();
const logFilePath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.log') // In packaged app
    : path.join(__dirname, 'app.log'); // In development



// GitHub API URL for latest release
const GITHUB_RELEASES_API = 'https://api.github.com/repos/Summit60/Odysee_2A3D_File_Manager/releases/latest';

//////////////Global Variables and Configuration//////////////

let mainWindow; // Reference to the main application window
let libraryFolder = null; // Restore library folder if cached
let appConfig = { libraryFolder: null, maxConcurrentDownloads: 5 }; // Initialize appConfig
let dbPath = path.join(appConfig.libraryFolder || '', 'main.db'); // Global variable to store the database path
let statusEmitter = null; // Keep track of lbrynet status updates
let maxConcurrentDownloads = appConfig.maxConcurrentDownloads; // Default value

//logToFile(`[INFO] Application Current Version: ${currentVersion}`);

//////////////Utility Functions//////////////

// Log to file function
function logToFile(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;

    try {
        fs.appendFileSync(logFilePath, logMessage, 'utf-8');
        console.log(logMessage.trim()); // Log to console directly
    } catch (error) {
        // Log error to console instead of recursive call
        console.error(`Failed to write to log file: ${error.message}`);
    }
}

ipcMain.handle('log-to-file', async (_, messageOrObject) => {
    try {
        // Handle both string messages and object format
        const message = typeof messageOrObject === 'string' 
            ? messageOrObject 
            : messageOrObject.message;
            
        logToFile(message);
    } catch (error) {
        console.error('[ERROR] Failed to log message:', error.message);
        throw error;
    }
});

function compareVersions(version1, version2) {
    const normalizeVersion = (version) =>
        version.split('.').map((part) => parseInt(part, 10) || 0);

    const [v1, v2] = [normalizeVersion(version1), normalizeVersion(version2)];

    for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
        const num1 = v1[i] || 0; // Treat missing parts as 0
        const num2 = v2[i] || 0;

        if (num1 > num2) return 1; // version1 is newer
        if (num1 < num2) return -1; // version2 is newer
    }
    return 0; // Versions are equal
}

async function checkForUpdates(currentVersion) {
    const updateUrl = 'https://api.github.com/repos/Summit60/Odysee_2A3D_File_Manager/releases/latest';

    try {
        logToFile('[INFO] Checking for updates...');
        logToFile(`[DEBUG] CurrentVersion Passed to checkForUpdates: ${currentVersion}`);

        const response = await axios.get(updateUrl);
        //logToFile('[DEBUG] GitHub API Response:', response.data);

        const latestRelease = response.data;

        if (!latestRelease || !latestRelease.tag_name) {
            throw new Error('Unable to determine the latest version from GitHub.');
        }

        const latestVersion = latestRelease.tag_name.replace(/^v/, ''); // Remove 'v' prefix
        logToFile(`[INFO] Current version: ${currentVersion}, Latest version: ${latestVersion}`);

        if (!currentVersion || !latestVersion) {
            throw new Error(
                `Invalid version(s) detected. CurrentVersion: ${currentVersion}, LatestVersion: ${latestVersion}`
            );
        }

        const comparisonResult = compareVersions(currentVersion, latestVersion);

        if (comparisonResult === 0) {
            logToFile('[INFO] Application is up to date.');
            dialog.showMessageBox({
                type: 'info',
                title: 'Up to Date',
                message: `Your application is up to date! Current version: ${currentVersion}`,
            });
        } else if (comparisonResult < 0) {
            logToFile(`[INFO] Update available: Current (${currentVersion}) < Latest (${latestVersion})`);
            const choice = dialog.showMessageBoxSync({
                type: 'question',
                buttons: ['Download', 'Cancel'],
                title: 'Update Available',
                message: `A new version is available: ${latestVersion}\n\nDo you want to download it?`,
            });

            if (choice === 0) {
                shell.openExternal('https://github.com/Summit60/Odysee_2A3D_File_Manager/releases');
            }
        } else {
            logToFile(`[INFO] Newer version installed: Current (${currentVersion}) > Latest (${latestVersion})`);
            dialog.showMessageBox({
                type: 'info',
                title: 'Newer Version Installed',
                message: `You have a newer version (${currentVersion}) than the latest release on GitHub (${latestVersion}).`,
            });
        }
    } catch (error) {
        logToFile('[ERROR] Failed to check for updates:', error.message);
        dialog.showMessageBox({
            type: 'error',
            title: 'Update Check Failed',
            message: `Failed to check for updates. Please try again later.\n\nError: ${error.message}`,
        });
    }
}

// Load configuration from config.json
function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            const configData = fs.readFileSync(configPath, 'utf-8');
            appConfig = JSON.parse(configData);
            //logToFile('[INFO] Config loaded successfully:', appConfig);
        } else {
            logToFile('[INFO] No config file found. Using defaults.');
        }
    } catch (err) {
        logToFile('[ERROR] Failed to load config:', err.message);
    }
}

loadConfig();

// Save configuration to config.json
function saveConfig() {
    try {
        fs.writeFileSync(configPath, JSON.stringify(appConfig, null, 2));
        logToFile('[INFO] Config saved successfully.');
    } catch (err) {
        logToFile('[ERROR] Failed to save config:', err.message);
    }
}

//////////////Database Functions//////////////

ipcMain.handle('query-database', async (event, queryType, params = {}) => {
    const dbPath = path.join(libraryFolder, 'main.db');
    logToFile('[INFO] Received query request:', queryType, params);

    if (!fs.existsSync(dbPath)) {
        logToFile('[ERROR] main.db does not exist at:', dbPath);
        throw new Error('main.db does not exist.');
    }

    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath);
        let query = '';
        let queryParams = [];

        // Define queries based on the query type
        switch (queryType) {
            case 'fetchAllFiles':
                query = `SELECT * FROM Claims`;
                break;

            case 'fetchDownloadedFiles':
                query = `SELECT * FROM Claims WHERE Downloaded = 1`;
                break;

            case 'fetchNewFiles':
                query = `SELECT * FROM Claims WHERE New = 1`;
                break;

            case 'fetchFilesByDeveloper':
                if (params.devName === 'ALL') {
                    // Count total files with Downloaded = 1 for "ALL"
                    query = `SELECT COUNT(*) as count FROM Claims WHERE Downloaded = 1`;
                } else {
                    query = `SELECT * FROM Claims WHERE LOWER(Dev_Name) = LOWER(?)`;
                    queryParams = [params.devName];
                }
                break;

            case 'searchFiles':
                query = `
                    SELECT * FROM Claims
                    WHERE LOWER(File_Name) LIKE LOWER(?) OR LOWER(Description) LIKE LOWER(?)
                `;
                queryParams = [`%${params.searchTerm}%`, `%${params.searchTerm}%`];
                break;

            case 'fetchFileByName':
                query = `SELECT * FROM Claims WHERE LOWER(File_Name) = LOWER(?)`;
                queryParams = [params.fileName];
                break;

            case 'fetchFileByPath':
                query = `SELECT * FROM Claims WHERE File_Path = ?`;
                queryParams = [params.filePath];
                break;

            default:
                logToFile('[ERROR] Unknown query type:', queryType);
                reject(new Error('Unknown query type.'));
                return;
        }

        logToFile('[DEBUG] Running query:', query, queryParams);

        db.all(query, queryParams, (err, rows) => {
            if (err) {
                logToFile('[ERROR] Query failed:', err.message);
                reject(err);
            } else {
                logToFile(`[INFO] Query "${queryType}" returned ${rows.length} rows.`);
                if (queryType === 'fetchFilesByDeveloper' && params.devName === 'ALL') {
                    resolve(rows[0]?.count || 0); // For ALL, return the count of downloaded files
                } else {
                    resolve(rows);
                }
            }
            db.close();
        });
    });
});

ipcMain.handle('check-multiple-file-statuses', async (event, fileNames) => {
    try {
        const dbPath = path.join(libraryFolder, 'main.db');
        const db = new sqlite3.Database(dbPath);

        const placeholders = fileNames.map(() => '?').join(', ');
        const query = `SELECT File_Name, Downloaded FROM Claims WHERE File_Name IN (${placeholders})`;

        return new Promise((resolve, reject) => {
            db.all(query, fileNames, (err, rows) => {
                if (err) {
                    logToFile('[ERROR] Failed to query file statuses:', err.message);
                    reject(err);
                } else {
                    const statuses = {};
                    rows.forEach(row => {
                        statuses[row.File_Name] = row.Downloaded === 1;
                    });
                    resolve(statuses);
                }
                db.close();
            });
        });
    } catch (error) {
        logToFile('[ERROR] Failed to handle check-multiple-file-statuses:', error.message);
        throw error;
    }
});

ipcMain.handle('fetch-developers', async () => {
    const dbPath = path.join(libraryFolder, 'main.db');
    const query = `
        SELECT Dev_Name, COUNT(*) AS totalFiles
        FROM Claims
        GROUP BY Dev_Name
        ORDER BY Dev_Name ASC;
    `;

    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath);
        db.all(query, (err, rows) => {
            if (err) {
                logToFile('[ERROR] Failed to fetch developers:', err.message);
                reject(err);
            } else {
                resolve(rows);
            }
            db.close();
        });
    });
});

function initializeDatabase() {
    const dbPath = path.join(libraryFolder, 'main.db');
    if (!fs.existsSync(dbPath)) {
        logToFile('[ERROR] main.db does not exist:', dbPath);
        return;
    }

    // Emit the event after confirming the database is ready
    ipcMain.emit('database-loaded', { message: 'Database initialized' });
}

ipcMain.handle('getAllDownloadedCounts', async (event, developerNames) => {
    const dbPath = path.join(libraryFolder, 'main.db');
    const query = `
        SELECT Dev_Name, COUNT(*) AS downloadedCount
        FROM Claims
        WHERE Downloaded = 1 AND Dev_Name IN (${developerNames.map(() => '?').join(', ')})
        GROUP BY Dev_Name;
    `;
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath);
        db.all(query, developerNames, (err, rows) => {
            if (err) {
                logToFile('[ERROR] Failed to fetch downloaded counts:', err.message);
                reject(err);
            } else {
                const counts = {};
                rows.forEach(row => {
                    counts[row.Dev_Name] = row.downloadedCount;
                });
                resolve(counts);
            }
            db.close();
        });
    });
});

ipcMain.handle('fetch-downloaded-file', async (event, fileName) => {
    const dbPath = path.join(libraryFolder, 'main.db');
    const db = new sqlite3.Database(dbPath);

    return new Promise((resolve, reject) => {
        db.get(
            'SELECT File_Path FROM Claims WHERE File_Name = ?',
            [fileName],
            (err, row) => {
                db.close();
                if (err) {
                    logToFile('[ERROR] Failed to fetch file path:', err.message);
                    return reject(new Error('Failed to fetch file path.'));
                }
                if (!row || !row.File_Path) {
                    logToFile('[WARN] File path not found for:', fileName);
                    return resolve(null);
                }
                resolve(row.File_Path);
            }
        );
    });
});

ipcMain.handle('fetchDownloadedCount', async (event) => {
    const dbPath = path.join(libraryFolder, 'main.db');
    const db = new sqlite3.Database(dbPath);

    return new Promise((resolve, reject) => {
        const query = `SELECT COUNT(*) AS DownloadedCount FROM Claims WHERE Downloaded = 1;`;

        db.get(query, [], (err, row) => {
            if (err) {
                logToFile('[ERROR] Failed to fetch downloaded count:', err.message);
                reject(err);
            } else {
                logToFile(`[DEBUG] Total downloaded count: ${row?.DownloadedCount || 0}`);
                resolve(row?.DownloadedCount || 0);
            }
        });

        db.close();
    });
});

ipcMain.handle('get-downloaded-files-for-developer', async (event, developerName) => {
    try {
        const dbPath = path.join(libraryFolder, 'main.db');
        const db = new sqlite3.Database(dbPath);

        const query = developerName === 'ALL'
            ? `SELECT COUNT(*) as count FROM Claims WHERE Downloaded = 1`
            : `SELECT COUNT(*) as count FROM Claims WHERE Downloaded = 1 AND Dev_Name = ?`;

        return new Promise((resolve, reject) => {
            db.get(query, [developerName], (err, row) => {
                db.close();
                if (err) {
                    logToFile('[ERROR] Failed to fetch downloaded count:', err.message);
                    reject(err);
                } else {
                    resolve(row.count); // Ensure only the numeric count is returned
                }
            });
        });
    } catch (err) {
        logToFile('[ERROR] Failed to get downloaded files for developer:', err.message);
        throw err;
    }
});

// Function to fetch developer counts (downloaded and new files)
ipcMain.handle('getAllDeveloperCounts', async () => {
    const dbPath = path.join(libraryFolder, 'main.db'); // Adjust to your database path
    const db = new sqlite3.Database(dbPath);

    return new Promise((resolve, reject) => {
        const query = `
            SELECT Dev_Name,
                   SUM(CASE WHEN Downloaded = 1 THEN 1 ELSE 0 END) AS downloaded,
                   SUM(CASE WHEN New = 1 THEN 1 ELSE 0 END) AS new
            FROM Claims
            GROUP BY Dev_Name
        `;

        db.all(query, [], (err, rows) => {
            if (err) {
                logToFile('[ERROR] Failed to fetch developer counts:', err.message);
                reject(err);
            } else {
                const counts = rows.reduce((acc, row) => {
                    acc[row.Dev_Name] = {
                        downloaded: row.downloaded || 0,
                        new: row.new || 0,
                    };
                    return acc;
                }, {});
                resolve(counts);
            }
            db.close();
        });
    });
});

ipcMain.handle('get-new-file-count', async (event, developerName) => {
    const db = new sqlite3.Database(dbPath);
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT COUNT(*) as newFileCount FROM Claims WHERE Dev_Name = ? AND New = 1`,
            [developerName],
            (err, row) => {
                if (err) {
                    logToFile('[ERROR] Failed to fetch new file count:', err.message);
                    reject(err);
                } else {
                    resolve(row.newFileCount || 0);
                }
            }
        );
    });
});

//////////////LBRY Daemon Management//////////////

// Function to check the status of lbrynet
async function checkLbrynetStatus() {
    try {
        logToFile('[DEBUG] Sending status API request...');
        const response = await fetch('http://localhost:5279', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'status', params: {} }),
        });

        const result = await response.json();
        //logToFile('[DEBUG] Full status API response:', JSON.stringify(result, null, 2));

        const blocksBehind = result.result?.wallet?.blocks_behind;

        if (blocksBehind === undefined || blocksBehind === null) {
            logToFile('[WARN] blocks_behind is null. Assuming synchronization not started.');
            return null; // Keep returning null to indicate no valid response yet
        }

        logToFile('[DEBUG] Parsed blocks_behind:', blocksBehind);
        return blocksBehind;
    } catch (error) {
        logToFile('[DEBUG] lbrynet status check failed:', error.message);
        return null; // Return null if the API isn't reachable
    }
}

function getLbrynetPath() {
    const platform = process.platform;
    const platformFolders = {
        'win32': 'lbrynet-win',
        'darwin': 'lbrynet-mac',
        'linux': 'lbrynet-linux'
    };
    
    const binaryNames = {
        'win32': 'lbrynet.exe',
        'darwin': 'lbrynet',
        'linux': 'lbrynet'
    };

    const lbrynetFolder = platformFolders[platform];
    const binaryName = binaryNames[platform];

    // Development path
    let basePath = path.join(__dirname, 'assets', lbrynetFolder);
    
    // Packaged path
    if (app.isPackaged) {
        basePath = path.join(process.resourcesPath, 'assets', lbrynetFolder);
    }

    const fullPath = path.normalize(path.join(basePath, binaryName));
    
    logToFile('[DEBUG] Platform:', platform);
    logToFile('[DEBUG] Base path:', basePath);
    logToFile('[DEBUG] Full binary path:', fullPath);
    
    return fullPath;
}

async function startLbrynet() {
    return new Promise(async (resolve, reject) => {
        const lbrynetPath = getLbrynetPath();
        logToFile('[DEBUG] Using lbrynet path:', lbrynetPath);

        // Single check for binary existence
        if (!fs.existsSync(lbrynetPath)) {
            const errorMessage = `[ERROR] lbrynet binary not found at: ${lbrynetPath}`;
            logToFile(errorMessage);
            return reject(new Error(errorMessage));
        }

        // Single permission setting for Unix-based systems
        if (process.platform !== 'win32') {
            try {
                fs.chmodSync(lbrynetPath, '755');
                logToFile('[INFO] Ensured executable permissions for lbrynet on:', lbrynetPath);
            } catch (error) {
                const chmodError = `[ERROR] Failed to set executable permissions for lbrynet: ${error.message}`;
                logToFile(chmodError);
                return reject(new Error(chmodError));
            }
        }

        logToFile('[INFO] Starting lbrynet...');
        const lbrynetProcess = spawn(
            `"${lbrynetPath}"`, // Wrap path in quotes
            ['start'], 
            {
                shell: true, // Always use shell on Windows for paths with spaces
                cwd: path.dirname(lbrynetPath),
                windowsHide: true,
                env: {
                    ...process.env,
                    PATH: `${path.dirname(lbrynetPath)};${process.env.PATH}`
                }
            }
        );

        //lbrynetProcess.stdout.on('data', (data) => {
        //    logToFile(`[lbrynet stdout]: ${data}`);
        //});

        //lbrynetProcess.stderr.on('data', (data) => {
        //    logToFile(`[lbrynet stderr]: ${data}`);
        //});

        lbrynetProcess.on('error', (error) => {
            logToFile('[ERROR] Failed to start lbrynet:', error.message);
            reject(error);
        });

        lbrynetProcess.on('close', (code) => {
            logToFile(`[INFO] lbrynet process exited with code: ${code}`);
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`lbrynet exited with code ${code}`));
            }
        });

        // Delay for daemon initialization
        setTimeout(() => {
            resolve();
        }, 2000);
    });
}


// Function to ensure lbrynet is running
async function ensureLbrynetRunning(mainWindow) {
    logToFile('[INFO] Checking lbrynet status...');

    // Step 1: Check initial status
    let blocksBehind = await checkLbrynetStatus();

    // Step 2: If lbrynet is not running, start it
    if (blocksBehind === null) {
        logToFile('[INFO] lbrynet is not running. Starting the daemon...');
        mainWindow.webContents.send('lbrynet-status', 'Starting lbrynet...');
        await startLbrynet();
    }

    // Step 3: Retry status requests after starting lbrynet
    for (let i = 0; i < 120; i++) { // Poll up to 120 times (120 seconds)
        await new Promise((resolve) => setTimeout(resolve, 1000));
        blocksBehind = await checkLbrynetStatus();

        if (blocksBehind !== null) {
            logToFile('[INFO] lbrynet is now running.');
            break;
        } else {
            logToFile(`[DEBUG] Retry ${i + 1}/120: Waiting for lbrynet to respond...`);
        }
    }

    if (blocksBehind === null) {
        throw new Error('lbrynet failed to start.');
    }

    // Step 4: Handle synchronization
    if (blocksBehind > 0 || blocksBehind === 0) {
        logToFile(`[DEBUG] Initial blocks_behind: ${blocksBehind}`);
        await waitForSync(mainWindow);
    }
}

// Wait for synchronization to complete
async function waitForSync(mainWindow) {
    let syncConfirmed = false;
    
    while (!syncConfirmed) {
        const blocksBehind = await checkLbrynetStatus();

        if (blocksBehind === 0) {
            // Double check to confirm sync
            const confirmCheck = await checkLbrynetStatus();
            if (confirmCheck === 0) {
                logToFile('[INFO] Blockchain is fully synchronized.');
                mainWindow.webContents.send('lbrynet-status', 'Synchronization complete.');
                mainWindow.webContents.send('sync-complete', true);

                // Check for updates after synchronization
                await checkForUpdates(currentVersion);
                
                syncConfirmed = true;
                break;
            }
        } else if (blocksBehind !== null) {
            logToFile(`[DEBUG] Syncing blockchain: ${blocksBehind} blocks remaining...`);
            mainWindow.webContents.send(
                'lbrynet-status',
                `Syncing blockchain: ${blocksBehind} blocks remaining...`
            );
        } else {
            logToFile('[DEBUG] Waiting for lbrynet to respond...');
            mainWindow.webContents.send('lbrynet-status', 'Waiting for lbrynet...');
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}

//Retry Logic During Startup
async function retryCheckLbrynetStatus(retries = 20, interval = 2000) {
    for (let attempt = 0; attempt < retries; attempt++) {
        const blocksBehind = await checkLbrynetStatus();

        if (blocksBehind !== null) {
            return blocksBehind; // Return as soon as a valid response is received
        }

        logToFile(`[DEBUG] Retry ${attempt + 1}/${retries}: Waiting for lbrynet to respond...`);
        await new Promise((resolve) => setTimeout(resolve, interval)); // Wait between retries
    }

    logToFile('[ERROR] lbrynet status did not respond after retries.');
    return null; // Return null if retries are exhausted
}

// Periodically send lbrynet status updates
ipcMain.on('start-status-updates', (event) => {
    logToFile('[INFO] Starting status updates...');

    // Simulate periodic updates for now
    statusEmitter = setInterval(() => {
        const exampleStatus = {
            blocksBehind: Math.max(0, Math.floor(Math.random() * 5000)), // Example: Fake blocksBehind
        };

        // Send update to renderer
        event.sender.send('lbrynet-status', exampleStatus);
        logToFile('[DEBUG] Sent lbrynet-status:', exampleStatus);

        // If fully synced, stop updates
        if (exampleStatus.blocksBehind === 0) {
            clearInterval(statusEmitter);
            statusEmitter = null;
        }
    }, 1000); // Adjust interval as needed
});

// Cleanup
ipcMain.on('stop-status-updates', () => {
    logToFile('[INFO] Stopping status updates...');
    if (statusEmitter) {
        clearInterval(statusEmitter);
        statusEmitter = null;
    }
});

//////////////Library Management//////////////

// Ensure library folder is set
async function ensureLibraryFolder(mainWindow) {
    try {
        if (!appConfig.libraryFolder || !fs.existsSync(appConfig.libraryFolder)) {
            logToFile('[INFO] Library folder is not set or does not exist. Prompting the user.');

            const folder = await showLibrarySelectionWindow();
            if (folder) {
                libraryFolder = folder;
                appConfig.libraryFolder = folder;
                saveConfig();
                logToFile(`[INFO] Library folder set to: ${folder}`);

                await ensureMainDbInLibrary(libraryFolder);
                logToFile('[INFO] main.db ensured in the library folder.');
            } else {
                logToFile('[ERROR] No library folder selected. Exiting application.');
                app.quit();
            }
        } else {
            libraryFolder = appConfig.libraryFolder;
            logToFile(`[INFO] Library folder exists: ${libraryFolder}`);

            await ensureMainDbInLibrary(libraryFolder);
            logToFile('[INFO] main.db ensured in the library folder.');
        }
    } catch (error) {
        logToFile(`[ERROR] Failed to ensure library folder or main.db: ${error.message}`);
        app.quit();
    }
}

async function ensureMainDbInLibrary(libraryFolder) {
    try {
        const dbPath = path.join(libraryFolder, 'main.db');
        const appDbPath = app.isPackaged
            ? path.join(process.resourcesPath, 'assets', 'main.db') // Packaged mode path
            : path.join(__dirname, 'assets', 'main.db'); // Development mode path

        logToFile(`[INFO] Checking for main.db in: ${dbPath}`);
        logToFile(`[INFO] Resolving main.db from: ${appDbPath}`);
        logToFile(`[DEBUG] Running on platform: ${process.platform}, isPackaged: ${app.isPackaged}`);

        // Ensure library folder exists
        if (!fs.existsSync(libraryFolder)) {
            fs.mkdirSync(libraryFolder, { recursive: true });
            logToFile('[INFO] Created library folder:', libraryFolder);
        }

        // Check for the existence of main.db
        if (!fs.existsSync(dbPath)) {
            // Validate source main.db
            if (!fs.existsSync(appDbPath)) {
                throw new Error(`Source main.db not found at: ${appDbPath}`);
            }

            // Ensure source main.db is accessible
            fs.accessSync(appDbPath, fs.constants.R_OK);
            logToFile('[INFO] Source main.db is readable.');

            logToFile('[INFO] main.db not found in the library folder. Copying...');
            try {
                fs.copyFileSync(appDbPath, dbPath);
                logToFile('[INFO] main.db copied successfully to the library folder.');
            } catch (copyError) {
                throw new Error(`Failed to copy main.db to library folder: ${copyError.message}`);
            }
        } else {
            logToFile('[INFO] main.db already exists in the library folder.');
        }
    } catch (error) {
        logToFile(`[ERROR] Failed to ensure main.db in the library folder: ${error.message}`);
        throw error; // Rethrow error to ensure calling functions handle it
    }
}

function showLibrarySelectionWindow() {
    return new Promise((resolve) => {
        const selectionWindow = new BrowserWindow({
            width: 600,
            height: 400,
            title: 'Select Library Folder',
            resizable: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
            },
        });

        // Load HTML content for the selection window
        selectionWindow.loadURL(`data:text/html,
            <html>
            <head>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        margin: 0;
                        padding: 20px;
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                        text-align: center;
                        overflow-wrap: break-word;
                    }
                    h2 {
                        margin-bottom: 20px;
                    }
                    p {
                        max-width: 90%;
                        margin: 20px 0;
                        line-height: 1.5;
                    }
                    button {
                        padding: 10px 20px;
                        font-size: 16px;
                        cursor: pointer;
                    }
                </style>
            </head>
            <body>
                <h2>Odysee 2A3D Library Manager</h2>
                <p>
                    To proceed, select a folder for your library. This folder will store your files
                    and the application database. You can change it later from the 'File' menu. Happy Sailing!
                </p>
                <p>- Summit_60</p>
                <button id="select-folder">Select Folder</button>
                <script>
                    const { ipcRenderer } = require('electron');
                    document.getElementById('select-folder').addEventListener('click', async () => {
                        const folder = await ipcRenderer.invoke('select-library-folder');
                        ipcRenderer.send('library-folder-selected', folder);
                    });
                </script>
            </body>
            </html>
        `);

        // Handle folder selection dialog
        ipcMain.handle('select-library-folder', async () => {
            const result = dialog.showOpenDialogSync(selectionWindow, {
                properties: ['openDirectory'],
                title: 'Select Library Folder',
            });
            return result ? result[0] : null; // Return selected folder path
        });

        // Save the selected folder and handle `main.db`
        ipcMain.once('library-folder-selected', async (event, folder) => {
            if (folder) {
                try {
                    const dbPath = path.join(folder, 'main.db');
                    const appDbPath = app.isPackaged
                        ? path.join(process.resourcesPath, 'assets', 'main.db')
                        : path.join(__dirname, 'assets', 'main.db');

                    logToFile(`[INFO] Selected folder: ${folder}`);
                    logToFile(`[INFO] Checking for main.db in: ${dbPath}`);

                    // Copy `main.db` if it doesn't exist in the selected folder
                    if (!fs.existsSync(dbPath)) {
                        logToFile('[INFO] main.db not found in the library folder. Copying...');
                        fs.copyFileSync(appDbPath, dbPath);
                        logToFile('[INFO] main.db copied successfully.');
                    } else {
                        logToFile('[INFO] main.db already exists in the library folder.');
                    }

                    resolve(folder); // Resolve with the folder path
                } catch (error) {
                    logToFile('[ERROR] Failed to ensure main.db in the library folder:', error.message);
                    dialog.showErrorBox(
                        'Error',
                        'Failed to set up the library folder. Please try again or select another folder.'
                    );
                    resolve(null); // Resolve null on failure
                }
            } else {
                logToFile('[WARN] No folder selected by the user.');
                resolve(null); // No folder selected
            }

            selectionWindow.close(); // Close the window
        });
    });
}

// Function to ensure database structure
function ensureDatabaseStructure(db) {
    return new Promise((resolve, reject) => {
        db.run(
            `CREATE TABLE IF NOT EXISTS Claims (
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
                File_Download_Name TEXT,
                Downloaded INTEGER,
                New INTEGER,
                File_Path TEXT
            )`,
            (err) => {
                if (err) {
                    logToFile('[ERROR] Failed to ensure database structure:', err);
                    reject(err);
                } else {
                    logToFile('[INFO] Database structure ensured.');
                    resolve();
                }
            }
        );
    });
}

// Utility function for cleanup
function cleanupFolders(fileFolder, developerFolder) {
    try {
        // Clean up the file folder if empty
        if (fs.existsSync(fileFolder)) {
            const files = fs.readdirSync(fileFolder);
            if (files.length === 0) {
                fs.rmdirSync(fileFolder, { recursive: true });
                logToFile('[INFO] Cleaned up empty file folder:', fileFolder);
            } else {
                logToFile('[DEBUG] File folder not empty:', fileFolder);
            }
        }

        // Clean up the developer folder if empty
        if (fs.existsSync(developerFolder)) {
            const files = fs.readdirSync(developerFolder);
            if (files.length === 0) {
                fs.rmdirSync(developerFolder, { recursive: true });
                logToFile('[INFO] Cleaned up empty developer folder:', developerFolder);
            } else {
                logToFile('[DEBUG] Developer folder not empty:', developerFolder);
            }
        }
    } catch (error) {
        logToFile('[ERROR] Failed to clean up folders:', error.message);
    }
}

//////////////IPC Handlers//////////////

ipcMain.handle('open-folder', async (event, filePath) => {
    try {
        const folderPath = path.dirname(filePath); // Get the directory of the file
        logToFile(`[INFO] Attempting to open folder: ${folderPath}`);

        // Determine the command based on the platform
        let command;
        if (process.platform === 'win32') {
            command = `explorer.exe "${folderPath}"`;
        } else if (process.platform === 'darwin') {
            command = `open "${folderPath}"`;
        } else if (process.platform === 'linux') {
            command = `xdg-open "${folderPath}"`;
        } else {
            throw new Error('Unsupported platform: ' + process.platform);
        }

        // Execute the command
        exec(command, (error) => {
            if (error) {
                logToFile('[WARN] Failed to execute command:', error.message);
                event.sender.send('alert', `Failed to open folder: ${error.message}`);
            } else {
                logToFile('[INFO] Folder opened successfully.');
            }
        });
    } catch (err) {
        logToFile('[ERROR] Failed to open folder:', err.message);
        throw err; // Re-throw the error for critical issues
    }
});

ipcMain.handle('getLibraryFolder', () => {
    return global.libraryFolder || ''; // Return the library folder path
});

ipcMain.handle('executeCommand', async (event, { command }) => {
    try {
        // Adjust command based on the platform
        const platform = process.platform;
        if (platform === 'win32') {
            // Windows-specific adjustments (e.g., cmd /c)
            command = `cmd /c ${command}`;
        } else if (platform === 'darwin' || platform === 'linux') {
            // Unix-based adjustments (e.g., bash -c for complex commands)
            command = `bash -c "${command}"`;
        }

        return new Promise((resolve, reject) => {
            exec(command, (err, stdout, stderr) => {
                if (err) {
                    logToFile(`[ERROR] Failed to execute command: ${command}`, stderr);
                    reject(new Error(stderr || 'Unknown error occurred'));
                } else {
                    logToFile(`[INFO] Command executed successfully: ${command}`, stdout);
                    resolve(stdout);
                }
            });
        });
    } catch (error) {
        logToFile(`[CRITICAL] Unexpected error while executing command: ${command}`, error.message);
        throw error; // Re-throw to the renderer process
    }
});

// Helper to check if a folder is empty
async function isEmptyFolder(folderPath) {
    try {
        const files = await fs.promises.readdir(folderPath);
        return files.length === 0;
    } catch (err) {
        if (err.code === 'ENOENT') {
            logToFile('[WARN] Folder not found, assuming empty:', folderPath);
            return true;
        }
        throw err;
    }
}

ipcMain.handle('delete-file', async (event, filePath) => {
    try {
        logToFile('[INFO] Starting deletion process for file:', filePath);

        if (!filePath) throw new Error('File path is null or undefined.');

        // Delete the file
        await fs.promises.unlink(filePath);
        logToFile('[INFO] File deleted:', filePath);

        // Get folder paths
        const fileFolder = path.dirname(filePath);
        const devFolder = path.dirname(fileFolder);

        // Check and delete empty folders
        try {
            if (await isEmptyFolder(fileFolder)) {
                await fs.promises.rmdir(fileFolder);
                logToFile('[INFO] File folder deleted:', fileFolder);
            }

            if (await isEmptyFolder(devFolder)) {
                await fs.promises.rmdir(devFolder);
                logToFile('[INFO] Developer folder deleted:', devFolder);
            }
        } catch (folderError) {
            logToFile('[WARN] Folder deletion error:', folderError.message);
        }

        // Update the database
        const downloadedDbPath = path.join(global.libraryFolder, 'main.db');
        await updateDatabaseRecord(downloadedDbPath, filePath);

        // Notify the renderer process
        const devName = path.basename(devFolder);
        if (!event.sender.isDestroyed()) {
            event.sender.send('file-status-updated', {
                fileName: path.basename(filePath),
                status: 'not-downloaded',
                developerName: devName,
            });
        }

        logToFile('[INFO] Deletion process completed successfully.');
        return { success: true };
    } catch (error) {
        logToFile(`[ERROR] Error during deletion process: ${error.message}\nStack: ${error.stack}`);
        return { success: false, message: error.message };
    }
});

// Function to update the database record
async function updateDatabaseRecord(dbPath, filePath) {
    const db = new sqlite3.Database(dbPath);
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE Claims SET Downloaded = 0, File_Path = NULL WHERE File_Path = ?`,
            [filePath],
            (err) => {
                if (err) {
                    logToFile('[ERROR] Failed to update database record:', err.message);
                    reject(new Error('Failed to update database record.'));
                } else {
                    logToFile('[INFO] Database record updated for file:', filePath);
                    resolve();
                }
            }
        );
    }).finally(() => {
        db.close();
    });
}

ipcMain.handle('get-config', async () => {
    return appConfig; // Return the entire appConfig object
});

ipcMain.handle('download-file', async (event, file) => {
    logToFile('[DEBUG] download-file called with:', file);

    if (!global.libraryFolder) {
        const message = 'Library folder not set. Please set it first.';
        logToFile('[ERROR]', message);
        event.sender.send('download-failed', message);
        event.sender.send('alert', message);
        return;
    }

    logToFile('[DEBUG] Global libraryFolder:', global.libraryFolder);

    const developerFolder = path.join(global.libraryFolder, file.Dev_Name || 'UnknownDeveloper');
    const fileFolder = path.join(developerFolder, file.Alt_File_Name || 'UnknownFile');
    const fileName = file.File_Download_Name || 'UnnamedFile';
    const finalFilePath = path.join(fileFolder, fileName);

    let statusEmitted = false;

    try {
        logToFile('[DEBUG] Ensuring folders exist...');
        fs.mkdirSync(developerFolder, { recursive: true });
        fs.mkdirSync(fileFolder, { recursive: true });

        const lbrynetExecutable = process.platform === 'win32' 
            ? 'lbrynet.exe' 
            : process.platform === 'darwin' 
            ? 'lbrynet-macos' 
            : 'lbrynet-linux';
        const lbrynetPath = getLbrynetPath();

        if (!fs.existsSync(lbrynetPath)) {
            logToFile('[ERROR] lbrynet executable not found:', lbrynetPath);
            throw new Error(`lbrynet executable missing: ${lbrynetPath}`);
        }

        if (process.platform !== 'win32') {
            fs.chmodSync(lbrynetPath, 0o755);
        }

        const finalFilePath = path.normalize(path.join(fileFolder, fileName));
        logToFile('[DEBUG] Final file path:', finalFilePath);

        logToFile('[DEBUG] Executing lbrynet...');
        const downloadProcess = spawn(lbrynetPath, [
            'get',
            file.Alt_File_URL || file.File_URL,
            `--file_name=${fileName}`,
            `--download_directory=${fileFolder}`,
            '--save_file=true'  // Add this flag
        ]);        

        downloadProcess.stdout.on('data', (data) => {
            const message = data.toString();
            logToFile(`[INFO] lbrynet stdout: ${message}`);
        });

        downloadProcess.stderr.on('data', (data) => {
            const message = data.toString();
            logToFile(`[ERROR] lbrynet stderr: ${message}`);
        });

        global.activeProcesses = global.activeProcesses || [];
        global.activeProcesses.push(downloadProcess.pid);

        downloadProcess.on('close', async (code) => {
            logToFile(`[DEBUG] Download process exited with code: ${code}`);

            if (code === 0) {
                logToFile(`[DEBUG] Verifying file existence for: ${file.File_Name}`);

                let retryCount = 0;
                const maxRetries = 5;
                const retryDelay = 1000;

                const checkFile = async () => {
                    if (fs.existsSync(finalFilePath)) {
                        logToFile('[INFO] File verified successfully:', finalFilePath);

                        if (!statusEmitted) {
                            event.sender.send('Trigger-counter', { status: 'downloaded', fileName: file.File_Name });
                            statusEmitted = true;
                        }

                        const downloadedDbPath = path.join(global.libraryFolder, 'main.db');
                        logToFile('[DEBUG] Updating Downloaded status in main.db at:', downloadedDbPath);

                        const db = new sqlite3.Database(downloadedDbPath);
                        db.run(
                            `UPDATE Claims SET Downloaded = 1, File_Path = ? WHERE File_Name = ?`,
                            [finalFilePath, file.File_Name],
                            (err) => {
                                if (err) {
                                    logToFile('[ERROR] Failed to update database:', err.message);
                                } else {
                                    logToFile('[INFO] File status updated to Downloaded in database.');
                                    event.sender.send('file-status-updated', {
                                        fileName: file.File_Name,
                                        status: 'downloaded',
                                    });
                                    event.sender.send('update-developer-stats', file.Dev_Name);
                                    event.sender.send('update-developer-stats', 'ALL');
                                }
                            }
                        );
                        db.close();
                        return true;
                    }
                    
                    if (retryCount < maxRetries) {
                        retryCount++;
                        logToFile(`[INFO] File not found, retry attempt ${retryCount} of ${maxRetries}`);
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                        return checkFile();
                    }
                    return false;
                };

                const fileExists = await checkFile();
                
                if (!fileExists) {
                    logToFile('[ERROR] File does not exist after all retries:', finalFilePath);
                    if (!statusEmitted) {
                        event.sender.send('Trigger-counter', { status: 'failed', fileName: file.File_Name });
                        statusEmitted = true;
                    }
                    cleanupFolders(fileFolder, developerFolder);
                }
            } else {
                logToFile('[ERROR] Download failed for file:', file.File_Name);
                if (!statusEmitted) {
                    event.sender.send('Trigger-counter', { status: 'failed', fileName: file.File_Name });
                    statusEmitted = true;
                }
                cleanupFolders(fileFolder, developerFolder);
            }

            global.activeProcesses = global.activeProcesses.filter(pid => pid !== downloadProcess.pid);
        });
    } catch (error) {
        logToFile('[ERROR] Failed to download file:', error);
        if (!statusEmitted) {
            event.sender.send('Trigger-counter', { status: 'failed', fileName: file.File_Name });
            statusEmitted = true;
        }
        cleanupFolders(fileFolder, developerFolder);
    }
});

ipcMain.handle('mark-file-as-not-new', async (event, fileClaimId) => {
    const dbPath = path.join(libraryFolder, 'main.db');
    const db = new sqlite3.Database(dbPath);

    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE Claims SET New = 0 WHERE File_Claim_ID = ?`,
            [fileClaimId],
            function (err) {
                if (err) {
                    logToFile('[ERROR] Failed to update New status:', err.message);
                    reject(err);
                } else {
                    logToFile(`[INFO] New status cleared for file: ${fileClaimId}`);
                    resolve(true);
                }
            }
        );
        db.close();
    });
});

// Cleanup function to remove _MEIxxxxx folders
const cleanTempFolders = () => {
    const tempDir = os.tmpdir();
    fs.readdir(tempDir, (err, files) => {
        if (err) {
            logToFile('[ERROR] Failed to read temp directory:', err.message);
            return;
        }

        // Filter and delete `_MEI` temp folders
        files
            .filter(file => file.startsWith('_MEI'))
            .forEach(folder => {
                const folderPath = path.join(tempDir, folder);

                // Check existence and delete folder
                fs.rm(folderPath, { recursive: true, force: true }, err => {
                    if (err) {
                        logToFile(`[ERROR] Failed to remove folder: ${folderPath}`, err.message);
                    } else {
                        logToFile(`[INFO] Removed temp folder: ${folderPath}`);
                    }
                });
            });
    });
};

// Listen for cleanup requests from renderer
ipcMain.handle('clean-temp-folders', async () => {
    logToFile('[INFO] Cleaning temp folders...');
    cleanTempFolders();
});

// IPC for killing active processes (for cancellation)
ipcMain.handle('kill-active-processes', async () => {
    logToFile('[DEBUG] Killing active processes...');
    if (global.activeProcesses) {
        global.activeProcesses.forEach(pid => {
            try {
                process.kill(pid);
                logToFile(`[INFO] Killed process with PID: ${pid}`);
            } catch (error) {
                logToFile(`[ERROR] Failed to kill process with PID: ${pid}`, error);
            }
        });
        global.activeProcesses = [];
    }
});


//////////////Menu Initialization//////////////

const createAppMenu = (mainWindow) => {
    const menuTemplate = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Set Library Folder',
                    click: async () => {
                        const folderPath = dialog.showOpenDialogSync({
                            properties: ['openDirectory'],
                        });

                        if (folderPath && folderPath.length > 0) {
                            global.libraryFolder = folderPath[0];
                            logToFile('[INFO] Library folder set to:', global.libraryFolder);
                            mainWindow.webContents.send('library-folder-set', global.libraryFolder);
                            mainWindow.webContents.send('reload-data');
                        } else {
                            logToFile('[INFO] Library folder selection canceled.');
                        }
                    },
                },
                {
                    label: 'Update Database',
                    click: async () => {
                        const filePaths = dialog.showOpenDialogSync(mainWindow, {
                            properties: ['openFile'],
                            filters: [
                                { name: 'Excel Files', extensions: ['ods'] },
                                { name: 'All Files', extensions: ['*'] },
                            ],
                        });
                
                        if (filePaths && filePaths.length > 0) {
                            const excelFile = filePaths[0];
                            logToFile('[INFO] Selected Excel file:', excelFile);
                
                            let progressWindow = new BrowserWindow({
                                parent: mainWindow,
                                modal: true,
                                width: 400,
                                height: 200,
                                frame: false,
                                resizable: false,
                                webPreferences: {
                                    nodeIntegration: true,
                                    contextIsolation: false,
                                },
                            });
                
                            progressWindow.loadURL(`data:text/html,
                                <style>
                                    body {
                                        font-family: Arial, sans-serif;
                                        text-align: center;
                                        padding: 20px;
                                    }
                                    h1 { font-size: 18px; }
                                </style>
                                <h1>Updating Database...(approx 1 minute)</h1>
                                <p>Please wait while the database is being updated.</p>
                            `);
                
                            try {
                                const { populateDatabase } = await import('./odsConverter.mjs');
                
                                const libraryFolder = appConfig.libraryFolder;
                                if (!libraryFolder || typeof libraryFolder !== 'string' || !fs.existsSync(libraryFolder)) {
                                    throw new Error('Library folder is not set or does not exist.');
                                }
                
                                const sheetIndex = 4;
                
                                // Call populateDatabase and get the result with counts
                                const { newFiles, updatedFiles, newDevs } = await populateDatabase(excelFile, sheetIndex, libraryFolder);
                
                                if (progressWindow) {
                                    progressWindow.close();
                                    progressWindow = null;
                                }
                
                                // Create a popup to display the results
                                let resultWindow = new BrowserWindow({
                                    parent: mainWindow,
                                    modal: true,
                                    width: 400,
                                    height: 300,
                                    frame: false,
                                    resizable: false,
                                    webPreferences: {
                                        nodeIntegration: true,
                                        contextIsolation: false,
                                    },
                                });
                
                                resultWindow.loadURL(`data:text/html,
                                    <style>
                                        body {
                                            font-family: Arial, sans-serif;
                                            text-align: center;
                                            padding: 20px;
                                        }
                                        h1 { font-size: 18px; margin-bottom: 10px; }
                                        p { margin: 10px 0; }
                                        button {
                                            margin-top: 20px;
                                            padding: 10px 20px;
                                            font-size: 16px;
                                            cursor: pointer;
                                        }
                                    </style>
                                    <h1>Database Update Complete</h1>
                                    <p>New Files Added: <b>${newFiles}</b></p>
                                    <p>Existing Files Updated: <b>${updatedFiles}</b></p>
                                    <button onclick="window.close()">Close</button>
                                `);
                
                                // Notify the renderer process to reload data
                                mainWindow.webContents.send('reload-data');
                                logToFile('[INFO] Notified renderer to reload data.');
                            } catch (error) {
                                logToFile('[ERROR] Failed to update database:', error.message);
                
                                if (progressWindow) {
                                    progressWindow.close();
                                    progressWindow = null;
                                }
                
                                dialog.showMessageBoxSync(mainWindow, {
                                    type: 'error',
                                    title: 'Update Failed',
                                    message: `An error occurred: ${error.message}`,
                                });
                            }
                        } else {
                            logToFile('[INFO] No file selected.');
                        }
                    },
                },                                             
                {
                    label: 'Settings',
                    click: () => {
                        mainWindow.webContents.send('open-settings');
                    },
                },
                {
                    label: 'Scan Folder',
                    click: () => {
                        mainWindow.webContents.send('scan-folder'); // Notify renderer
                    },
                },
                {
                    label: 'Check for Updates',
                    click: async () => {
                        await checkForUpdates(currentVersion);
                    },
                },
                { role: 'quit' },
            ],
        },
        {
            label: 'Debug',
            submenu: [
                {
                    label: 'Toggle Developer Tools',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Shift+I' : 'Ctrl+Shift+I',
                    click: () => {
                        mainWindow.webContents.toggleDevTools();
                    },
                },
                {
                    label: 'Erase Database',
                    click: async () => {
                        const choice = dialog.showMessageBoxSync({
                            type: 'warning',
                            title: 'Erase Database',
                            message: 'Are you sure you want to erase the database? This will remove all entries from the database. You will have to use "Update Database" to restore entries.',
                            buttons: ['Cancel', 'Erase'],
                            defaultId: 0,
                            cancelId: 0,
                        });
        
                        if (choice === 1) {
                            if (!global.libraryFolder || typeof global.libraryFolder !== 'string') {
                                dialog.showMessageBoxSync({
                                    type: 'error',
                                    title: 'Error',
                                    message: 'Library folder is not set. Please set the library folder first.',
                                });
                                return;
                            }
        
                            const dbPath = path.join(global.libraryFolder, 'main.db');
                            let db;
        
                            try {
                                db = new sqlite3.Database(dbPath);
                                db.serialize(() => {
                                    db.run('DELETE FROM Claims', (err) => {
                                        if (err) {
                                            throw new Error(`Failed to erase database: ${err.message}`);
                                        }
                                        mainWindow.webContents.send('reload-data');
                                        logToFile('[INFO] Database successfully erased.');
                                        dialog.showMessageBoxSync({
                                            type: 'info',
                                            title: 'Erase Database',
                                            message: 'The database has been successfully erased.',
                                        });
                                    });
                                });
                            } catch (error) {
                                logToFile('[ERROR]', `Platform: ${process.platform}, Error: ${error.message}`);
                                dialog.showMessageBoxSync({
                                    type: 'error',
                                    title: 'Error',
                                    message: error.message,
                                });
                            } finally {
                                if (db) db.close();
                            }
                        }
                    },
                },
                {
                    label: 'Reset Downloads',
                    click: async () => {
                        const choice = dialog.showMessageBoxSync({
                            type: 'warning',
                            title: 'Reset Downloads',
                            message: 'Are you sure you want to reset downloads? This will set all entries in the database to "Not Downloaded".',
                            buttons: ['Cancel', 'Reset'],
                            defaultId: 0,
                            cancelId: 0,
                        });
        
                        if (choice === 1) {
                            if (!global.libraryFolder || typeof global.libraryFolder !== 'string') {
                                dialog.showMessageBoxSync({
                                    type: 'error',
                                    title: 'Error',
                                    message: 'Library folder is not set. Please set the library folder first.',
                                });
                                return;
                            }
        
                            const dbPath = path.join(global.libraryFolder, 'main.db');
                            let db;
        
                            try {
                                db = new sqlite3.Database(dbPath);
                                db.serialize(() => {
                                    db.run('UPDATE Claims SET Downloaded = 0', (err) => {
                                        if (err) {
                                            throw new Error(`Failed to reset downloads: ${err.message}`);
                                        }
                                        mainWindow.webContents.send('reload-data');
                                        logToFile('[INFO] Downloads successfully reset.');
                                        dialog.showMessageBoxSync({
                                            type: 'info',
                                            title: 'Reset Downloads',
                                            message: 'Downloads have been successfully reset.',
                                        });
                                    });
                                });
                            } catch (error) {
                                logToFile('[ERROR]', `Platform: ${process.platform}, Error: ${error.message}`);
                                dialog.showMessageBoxSync({
                                    type: 'error',
                                    title: 'Error',
                                    message: error.message,
                                });
                            } finally {
                                if (db) db.close();
                            }
                        }
                    },
                },
            ],
        }        
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
};

//////////////Application Lifecycle Events//////////////

//Creates the main application window and sets up initial configurations.
app.on('ready', async () => {
    //logToFile('[INFO] Electron app is ready.');

    await ensureLibraryFolder(mainWindow);

    dbPath = path.join(libraryFolder, 'main.db');
    if (!fs.existsSync(dbPath)) {
        logToFile('[INFO] Creating new database: main.db');
        const db = new sqlite3.Database(dbPath);
        try {
            await ensureDatabaseStructure(db);
            logToFile('[INFO] Database structure ensured.');
        } catch (error) {
            logToFile(`[ERROR] Failed to ensure database structure: ${error.stack}`);
            app.quit();
        } finally {
            db.close();
        }
    }

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 1000,
        icon: process.platform === 'win32'
            ? path.join(appPath, 'assets', 'icon.ico')
            : process.platform === 'darwin'
            ? path.join(appPath, 'assets', 'icon.icns')
            : path.join(appPath, 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(appPath, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: true,
            devTools: process.env.NODE_ENV !== 'production',
        },
    });

    mainWindow.loadURL(`file://${path.join(app.getAppPath(), 'src', 'index.html')}`);

    try {
        logToFile('[DEBUG] About to call ensureLbrynetRunning...');
        await ensureLbrynetRunning(mainWindow);
    } catch (error) {
        logToFile(`[ERROR] Failed to start lbrynet: ${error.stack}`);
    }

    // Create the menu
    createAppMenu(mainWindow);
});

// Handles application exit when all windows are closed.
app.on('window-all-closed', () => {
    logToFile('[INFO] All windows closed. Exiting application.');
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Ensure proper cleanup on app quit
app.on('quit', () => {
    logToFile('[INFO] App is quitting...');
    // Perform any necessary cleanup here (e.g., closing database connections)
});

// Handles application reactivation on macOS when no windows are open.
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        logToFile('[INFO] Activating new browser window.');
        mainWindow = new BrowserWindow();
    }
});


/////////////////other//////////////////

// Ensure the config file exists
if (!fs.existsSync(configPath)) {
    logToFile('[INFO] Config file not found. Creating a default one at:', configPath);
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
}

// Set library folder from config if available
if (appConfig.libraryFolder) {
    libraryFolder = appConfig.libraryFolder;
    global.libraryFolder = appConfig.libraryFolder; // Ensure global variable is updated
    logToFile(`[INFO] Restored library folder: ${libraryFolder}`);
} else {
    logToFile('[ERROR] Library folder not found in configuration. Prompt user to set it.');
}

// Listen for updated maxConcurrentDownloads from renderer
ipcMain.handle('update-max-downloads', (event, value) => {
    maxConcurrentDownloads = value;
    logToFile(`[INFO] Max concurrent downloads updated to: ${maxConcurrentDownloads}`);
    appConfig.maxConcurrentDownloads = maxConcurrentDownloads
    saveConfig(); // Save the updated value to config
});

// Expose current maxConcurrentDownloads
ipcMain.handle('get-max-downloads', () => appConfig.maxConcurrentDownloads);

ipcMain.handle('database-updated', async () => {
    logToFile('[INFO] Database updated. Notifying renderer to reload data...');
    mainWindow.webContents.send('reload-data');
});

ipcMain.handle('select-folder', async () => {
    const result = dialog.showOpenDialogSync({
        properties: ['openDirectory'],
    });
    return result ? result[0] : null;
});

ipcMain.handle('scan-folder', async (_, folderPath) => {
    const normalizedFolderPath = path.normalize(folderPath);
    const dbPath = path.resolve(libraryFolder, 'main.db');
    const db = new sqlite3.Database(dbPath);

    const fileNames = await new Promise((resolve, reject) => {
        db.all('SELECT File_Download_Name FROM Claims', [], (err, rows) => {
            if (err) return reject(err);
            resolve(rows.map((row) => row.File_Download_Name));
        });
    });

    const matchingFiles = [];
    const scanFolderRecursive = async (folder) => {
        try {
            const entries = await fs.promises.readdir(folder, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(folder, entry.name);
                if (entry.isDirectory()) {
                    await scanFolderRecursive(fullPath);
                } else if (fileNames.includes(entry.name)) {
                    matchingFiles.push(fullPath);
                }
            }
        } catch (error) {
            logToFile('[ERROR] Folder scan failed:', error.message);
            throw error;
        }
    };

    await scanFolderRecursive(normalizedFolderPath);
    return matchingFiles;
});

ipcMain.handle('process-scanned-files', async (_, { files, action }) => {
    const dbPath = path.join(libraryFolder, 'main.db');
    const db = new sqlite3.Database(dbPath);

    // Wrap database operations in a promise for better control
    const processFile = (filePath) => {
        const fileName = path.basename(filePath);
        return new Promise((resolve, reject) => {
            db.get(
                'SELECT Dev_Name, Alt_File_Name, File_Claim_ID FROM Claims WHERE File_Download_Name = ?',
                [fileName],
                (err, row) => {
                    if (err) {
                        logToFile('[ERROR] Database query failed:', err.message);
                        reject(err);
                    }
                    resolve(row);
                }
            );
        });
    };

    try {
        const results = [];
        for (const file of files) {
            const metadata = await processFile(file);
            if (!metadata) {
                logToFile('[WARN] No matching record found for:', file);
                continue;
            }

            const { Dev_Name, Alt_File_Name, File_Claim_ID } = metadata;
            const destinationPath = path.join(libraryFolder, Dev_Name, Alt_File_Name, path.basename(file));

            if (action === 'move') {
                await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
                await fs.promises.rename(file, destinationPath);
                logToFile('[INFO] Moved file to:', destinationPath);
            }

            // Update database with new file status
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE Claims SET File_Path = ?, Downloaded = 1 WHERE File_Claim_ID = ?`,
                    [action === 'move' ? destinationPath : file, File_Claim_ID],
                    (err) => {
                        if (err) reject(err);
                        resolve();
                    }
                );
            });

            results.push({
                originalPath: file,
                newPath: action === 'move' ? destinationPath : file,
                success: true
            });
        }

        return results;
    } finally {
        db.close();
    }
});

ipcMain.handle('get-library-folder', async () => {
    try {
        const libraryFolder = appConfig.libraryFolder;
        if (!libraryFolder) throw new Error('Library folder is not set.');
        return libraryFolder;
    } catch (error) {
        logToFile('[ERROR] Failed to fetch library folder:', error.message);
        throw error;
    }
});


module.exports = { logToFile };