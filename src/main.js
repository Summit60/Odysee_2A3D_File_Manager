const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { shell } = require('electron');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const axios = require('axios')

// Ensure this is at the top of your main.js
const currentVersion = app.getVersion();
console.log(`[INFO] Application Current Version: ${currentVersion}`);

// GitHub API URL for latest release
const GITHUB_RELEASES_API = 'https://api.github.com/repos/Summit60/Odysee_2A3D_File_Manager/releases/latest';

const getAppPath = () => app.isPackaged
    ? path.join(process.resourcesPath) // In packaged app
    : __dirname;                       // In development

const appPath = getAppPath();

// Log file path
const logFilePath = path.join(app.getPath('userData'), 'app.log');

// Log to file function
function logToFile(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    try {
        fs.appendFileSync(logFilePath, logMessage, 'utf-8');
        console.log(logMessage.trim()); // Also log to console for debugging
    } catch (error) {
        console.error('[ERROR] Failed to write to log file:', error.message);
    }
}

ipcMain.handle('log-to-file', async (event, message) => {
    const logFilePath = path.join(app.getPath('userData'), 'app.log');
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    try {
        fs.appendFileSync(logFilePath, logMessage, 'utf-8');
        console.log(logMessage.trim()); // Also log to console for debugging
    } catch (error) {
        console.error('[ERROR] Failed to write to log file:', error.message);
    }
});


//Config
// Get the userData path
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'config.json');

// Default configuration
const defaultConfig = {
    libraryFolder: null,
    lastDatabase: null,
};

// Ensure the config file exists
if (!fs.existsSync(configPath)) {
    console.log('[INFO] Config file not found. Creating a default one at:', configPath);
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
}

let mainWindow; // Reference to the main application window
let dbPath = null; // Global variable to store the database path
let libraryFolder = null; // Restore library folder if cached

let appConfig = { libraryFolder: null, lastDatabase: null }; // Initialize appConfig

// Load configuration from config.json
function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            const configData = fs.readFileSync(configPath, 'utf-8');
            appConfig = JSON.parse(configData);
            console.log('[INFO] Config loaded successfully:', appConfig);
        } else {
            console.log('[INFO] No config file found. Using defaults.');
        }
    } catch (err) {
        console.error('[ERROR] Failed to load config:', err.message);
    }
}

// Load config on app start
loadConfig();

// Save configuration to config.json
function saveConfig() {
    try {
        fs.writeFileSync(configPath, JSON.stringify(appConfig, null, 2));
        console.log('[INFO] Config saved successfully.');
    } catch (err) {
        console.error('[ERROR] Failed to save config:', err.message);
    }
}

// Set library folder from config if available
if (appConfig.libraryFolder) {
    libraryFolder = appConfig.libraryFolder;
    global.libraryFolder = appConfig.libraryFolder; // Ensure global variable is updated
    console.log(`[INFO] Restored library folder: ${libraryFolder}`);
} else {
    console.error('[ERROR] Library folder not found in configuration. Prompt user to set it.');
}

// Set database path from config if available
if (appConfig.lastDatabase) {
    dbPath = appConfig.lastDatabase;
    console.log(`[INFO] Restored last database: ${dbPath}`);
}

// Ensure library folder is set
async function ensureLibraryFolder(mainWindow) {
    if (!appConfig.libraryFolder || !fs.existsSync(appConfig.libraryFolder)) {
        console.log('[INFO] Library folder is not set or does not exist. Prompting the user.');

        const folder = await showLibrarySelectionWindow();
        if (folder) {
            libraryFolder = folder;
            appConfig.libraryFolder = folder;
            saveConfig();
            console.log('[INFO] Library folder set to:', folder);
        } else {
            console.error('[ERROR] No library folder selected. Exiting application.');
            app.quit();
        }
    } else {
        libraryFolder = appConfig.libraryFolder;
        console.log('[INFO] Library folder exists:', libraryFolder);
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
                        line-height: 1;
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
                    To proceed, you need to select a folder to use as your library. This folder 
                    will store all of your Treasures as well as database files used in the application. you
                    can change this later in the 'file' menu. Happy Sailing!
                </p>
                <p>
                - Summit_60
                </p>
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

        // Handle folder selection from the dialog
        ipcMain.handle('select-library-folder', async () => {
            const result = dialog.showOpenDialogSync(selectionWindow, {
                properties: ['openDirectory'],
                title: 'Select Library Folder',
            });
            return result ? result[0] : null;
        });

        // Save the selected folder and close the selection window
        ipcMain.once('library-folder-selected', (event, folder) => {
            selectionWindow.close();
            resolve(folder); // Resolve the promise with the selected folder
        });
    });
}




///////////////  LBRY BLOCKCHAIN CONNECTION  /////////////// 


// Function to check the status of lbrynet
async function checkLbrynetStatus() {
    try {
        console.log('[DEBUG] Sending status API request...');
        const response = await fetch('http://localhost:5279', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'status', params: {} }),
        });

        const result = await response.json();
        console.log('[DEBUG] Full status API response:', JSON.stringify(result, null, 2));

        const blocksBehind = result.result?.wallet?.blocks_behind;

        if (blocksBehind === undefined || blocksBehind === null) {
            console.warn('[WARN] blocks_behind is null. Assuming synchronization not started.');
            return null; // Keep returning null to indicate no valid response yet
        }

        console.log('[DEBUG] Parsed blocks_behind:', blocksBehind);
        return blocksBehind;
    } catch (error) {
        console.error('[DEBUG] lbrynet status check failed:', error.message);
        return null; // Return null if the API isn't reachable
    }
}

// Function to start lbrynet
async function startLbrynet() {
    return new Promise((resolve, reject) => {
        const lbrynetPath = app.isPackaged
            ? path.join(process.resourcesPath, 'utils', 'lbrynet.exe') // Packaged path
            : path.resolve('./src/utils/lbrynet.exe'); // Development path

        console.log('[DEBUG] Resolved lbrynet.exe path:', lbrynetPath);
        const quotedLbrynetPath = `"${lbrynetPath}"`; // Quote the path to handle spaces

        console.log('[INFO] Starting lbrynet...');
        console.log(`[DEBUG] Resolved path to lbrynet.exe: ${quotedLbrynetPath}`);

        const lbrynetProcess = spawn(quotedLbrynetPath, ['start'], {
            shell: true, // Use shell to handle quoted paths
            cwd: path.dirname(lbrynetPath), // Ensure the working directory is set
        });

        lbrynetProcess.stdout.on('data', (data) => {
            console.log(`[lbrynet stdout]: ${data}`);
        });

        lbrynetProcess.stderr.on('data', (data) => {
            console.error(`[lbrynet stderr]: ${data}`);
        });

        lbrynetProcess.on('error', (error) => {
            console.error('[ERROR] Failed to start lbrynet:', error.message);
            reject(error);
        });

        lbrynetProcess.on('close', (code) => {
            console.log(`[INFO] lbrynet process exited with code: ${code}`);
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`lbrynet exited with code ${code}`));
            }
        });

        // Delay for daemon initialization
        setTimeout(() => {
            resolve();
        }, 2000); // 2 seconds delay
    });
}

// Function to ensure lbrynet is running
async function ensureLbrynetRunning(mainWindow) {
    console.log('[INFO] Checking lbrynet status...');

    // Step 1: Check initial status
    let blocksBehind = await checkLbrynetStatus();

    // Step 2: If lbrynet is not running, start it
    if (blocksBehind === null) {
        console.log('[INFO] lbrynet is not running. Starting the daemon...');
        mainWindow.webContents.send('lbrynet-status', 'Starting lbrynet...');
        await startLbrynet();
    }

    // Step 3: Retry status requests after starting lbrynet
    for (let i = 0; i < 10; i++) { // Poll up to 10 times (10 seconds)
        await new Promise((resolve) => setTimeout(resolve, 1000));
        blocksBehind = await checkLbrynetStatus();

        if (blocksBehind !== null) {
            console.log('[INFO] lbrynet is now running.');
            break;
        } else {
            console.log(`[DEBUG] Retry ${i + 1}/10: Waiting for lbrynet to respond...`);
        }
    }

    if (blocksBehind === null) {
        throw new Error('lbrynet failed to start.');
    }

    // Step 4: Handle synchronization
    if (blocksBehind > 0 || blocksBehind === 0) {
        console.log(`[DEBUG] Initial blocks_behind: ${blocksBehind}`);
        await waitForSync(mainWindow);
    }
}

// Wait for synchronization to complete
async function waitForSync(mainWindow) {
    while (true) {
        const blocksBehind = await checkLbrynetStatus();

        if (blocksBehind === 0) {
            console.log('[INFO] Blockchain is fully synchronized.');
            mainWindow.webContents.send('lbrynet-status', 'Synchronization complete.');

            // Check for updates after synchronization
            await checkForUpdates(currentVersion);

            break; // Exit the loop when synchronized
        } else if (blocksBehind !== null) {
            console.log(`[DEBUG] Syncing blockchain: ${blocksBehind} blocks remaining...`);
            mainWindow.webContents.send(
                'lbrynet-status',
                `Syncing blockchain: ${blocksBehind} blocks remaining...`
            );
        } else {
            console.log('[DEBUG] Waiting for lbrynet to respond...');
            mainWindow.webContents.send('lbrynet-status', 'Waiting for lbrynet...');
        }

        await new Promise((resolve) => setTimeout(resolve, 1000)); // Poll every second
    }
}

//Retry Logic During Startup
async function retryCheckLbrynetStatus(retries = 20, interval = 2000) {
    for (let attempt = 0; attempt < retries; attempt++) {
        const blocksBehind = await checkLbrynetStatus();

        if (blocksBehind !== null) {
            return blocksBehind; // Return as soon as a valid response is received
        }

        console.log(`[DEBUG] Retry ${attempt + 1}/${retries}: Waiting for lbrynet to respond...`);
        await new Promise((resolve) => setTimeout(resolve, interval)); // Wait between retries
    }

    console.error('[ERROR] lbrynet status did not respond after retries.');
    return null; // Return null if retries are exhausted
}

let statusEmitter = null; // Keep track of lbrynet status updates

// Periodically send lbrynet status updates
ipcMain.on('start-status-updates', (event) => {
    console.log('[INFO] Starting status updates...');

    // Simulate periodic updates for now
    statusEmitter = setInterval(() => {
        const exampleStatus = {
            blocksBehind: Math.max(0, Math.floor(Math.random() * 5000)), // Example: Fake blocksBehind
        };

        // Send update to renderer
        event.sender.send('lbrynet-status', exampleStatus);
        console.log('[DEBUG] Sent lbrynet-status:', exampleStatus);

        // If fully synced, stop updates
        if (exampleStatus.blocksBehind === 0) {
            clearInterval(statusEmitter);
            statusEmitter = null;
        }
    }, 1000); // Adjust interval as needed
});

// Cleanup
ipcMain.on('stop-status-updates', () => {
    console.log('[INFO] Stopping status updates...');
    if (statusEmitter) {
        clearInterval(statusEmitter);
        statusEmitter = null;
    }
});



///////////////  LBRY BLOCKCHAIN CONNECTION  ///////////////





/**
 * Creates the main application window and sets up initial configurations.
 */
app.on('ready', async() => {
    console.log('[INFO] Electron app is ready.');

    await ensureLibraryFolder(mainWindow);

    // Check if downloaded.db exists in the library folder
    const downloadedDbPath = path.join(libraryFolder, 'downloaded.db');
    if (!fs.existsSync(downloadedDbPath)) {
        console.log('[INFO] downloaded.db does not exist. Creating a new database...');
        const db = new sqlite3.Database(downloadedDbPath);

        // Ensure the database structure exists
        ensureDatabaseStructure(db)
            .then(() => {
                console.log('[INFO] Database structure ensured.');
            })
            .catch((err) => {
                console.error('[ERROR] Failed to ensure database structure:', err.message);
                app.quit(); // Exit if database creation fails
            })
            .finally(() => {
                db.close();
            });
    } else {
        console.log('[INFO] downloaded.db already exists:', downloadedDbPath);
    }

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 1000,
        icon: path.join(appPath, 'assets', 'icon.ico'), // Ensure 'icon.png' exists
        webPreferences: {
            preload: path.join(appPath, 'preload.js'),
            nodeIntegration: true, // Disable Node.js integration in renderer
            contextIsolation: true, // Enable context isolation
            devTools: true, // Explicitly enable DevTools
        },
    });
    
    // Load the index.html file
    mainWindow.loadURL(`file://${path.join(__dirname, '/index.html')}`);

    try {
        console.log('[DEBUG] About to call ensureLbrynetRunning...');
        await ensureLbrynetRunning(mainWindow);
    } catch (error) {
        console.error('[ERROR] Failed to start lbrynet:', error.message);
    }
    
    // Create the menu
    const menu = Menu.buildFromTemplate([
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
                            console.log('[INFO] Library folder set to:', global.libraryFolder);
                            mainWindow.webContents.send('library-folder-set', global.libraryFolder);
                        } else {
                            console.log('[INFO] Library folder selection canceled.');
                        }
                    },
                },
                {
                    label: 'Load Database',
                    click: async () => {
                        await loadDatabase(mainWindow);
                    },
                },
                
                {
                    label: 'Convert ODS to DB',
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
                            console.log('[INFO] Selected Excel file:', excelFile);
                
                            // Create a modal for "Creating Database"
                            let progressWindow = new BrowserWindow({
                                parent: mainWindow,
                                modal: true,
                                width: 400,
                                height: 200,
                                frame: false, // No title bar for the window
                                resizable: false,
                                webPreferences: {
                                    nodeIntegration: true, // Enable Node.js integration if needed
                                    contextIsolation: false, // Disable context isolation for simplicity
                                },
                            });
                
                            // Load an inline HTML page for the progress window
                            progressWindow.loadURL(`data:text/html,
                                <style>
                                    body {
                                        font-family: Arial, sans-serif;
                                        text-align: center;
                                        padding: 20px;
                                    }
                                    h1 { font-size: 18px; }
                                </style>
                                <h1>Creating Database...(approx 1 minute)</h1>
                                <p>Please wait while the database is being created.</p>
                            `);
                
                            try {
                                // Dynamically import xlsConverter.mjs
                                const { populateDatabase } = await import('./xlsConverter.mjs');
                
                                const libraryFolder = appConfig.libraryFolder;
                                if (!libraryFolder || typeof libraryFolder !== 'string' || !fs.existsSync(libraryFolder)) {
                                    console.error('[ERROR] Invalid library folder:', libraryFolder);
                                    throw new Error('Library folder is not set or does not exist.');
                                }
                                console.log('[DEBUG] Using libraryFolder:', libraryFolder);
                
                                const sheetIndex = 4;
                                const dbPath = await populateDatabase(excelFile, sheetIndex, libraryFolder);
                
                                // Close the "Creating Database" window before showing the success dialog
                                if (progressWindow) {
                                    progressWindow.close();
                                    progressWindow = null; // Cleanup reference
                                }
                
                                // Show success dialog
                                dialog.showMessageBoxSync(mainWindow, {
                                    type: 'info',
                                    title: 'Conversion Successful',
                                    message: `The Excel file was successfully converted and saved to the database at:\n${dbPath}`,
                                });
                
                                console.log('[INFO] Database conversion complete, exported to:', dbPath);
                            } catch (error) {
                                console.error('[ERROR] Failed to convert database:', error.message);
                
                                // Close the "Creating Database" window before showing the error dialog
                                if (progressWindow) {
                                    progressWindow.close();
                                    progressWindow = null; // Cleanup reference
                                }
                
                                // Show error dialog
                                dialog.showMessageBoxSync(mainWindow, {
                                    type: 'error',
                                    title: 'Conversion Failed',
                                    message: `An error occurred: ${error.message}`,
                                });
                            }
                        } else {
                            console.log('[INFO] No file selected.');
                        }
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
            label: 'View',
            submenu: [
                {
                    label: 'Toggle Developer Tools',
                    accelerator: 'Ctrl+Shift+I', // Shortcut key
                    click: () => {
                        mainWindow.webContents.toggleDevTools();
                    },
                },
            ],
        },
    ]);

    Menu.setApplicationMenu(menu);
});

async function loadDatabase(mainWindow) {
    console.log('[INFO] Initiating database load process.');

    const dbPathResult = dialog.showOpenDialogSync(mainWindow, {
        properties: ['openFile'],
        title: 'Select Database File',
        filters: [
            { name: 'SQLite Databases', extensions: ['db'] },
            { name: 'All Files', extensions: ['*'] },
        ],
    });

    if (dbPathResult && dbPathResult.length > 0) {
        const selectedDbPath = dbPathResult[0];
        console.log('[INFO] Database loaded:', selectedDbPath);

        // Update the global `dbPath`
        dbPath = selectedDbPath;

        // Save to `appConfig` and persist to config.json
        appConfig.lastDatabase = selectedDbPath;
        saveConfig();
        console.log('[INFO] lastDatabase updated in config:', appConfig.lastDatabase);

        // Notify renderer process about the loaded database
        console.log('[DEBUG] Sending database-loaded event to renderer.');
        mainWindow.webContents.send('database-loaded', selectedDbPath);
    } else {
        console.log('[INFO] Database selection canceled.');
    }
}

async function checkForUpdates(currentVersion) {
    const updateUrl = 'https://api.github.com/repos/Summit60/Odysee_2A3D_File_Manager/releases/latest';

    try {
        console.log('[INFO] Checking for updates...');
        console.log(`[DEBUG] CurrentVersion Passed to checkForUpdates: ${currentVersion}`);

        const response = await axios.get(updateUrl);
        console.log('[DEBUG] GitHub API Response:', response.data);

        const latestRelease = response.data;

        if (!latestRelease || !latestRelease.tag_name) {
            throw new Error('Unable to determine the latest version from GitHub.');
        }

        const latestVersion = latestRelease.tag_name.replace(/^v/, ''); // Remove 'v' prefix
        console.log(`[INFO] Current version: ${currentVersion}, Latest version: ${latestVersion}`);

        if (!currentVersion || !latestVersion) {
            throw new Error(
                `Invalid version(s) detected. CurrentVersion: ${currentVersion}, LatestVersion: ${latestVersion}`
            );
        }

        const comparisonResult = compareVersions(currentVersion, latestVersion);

        if (comparisonResult === 0) {
            console.log('[INFO] Application is up to date.');
            dialog.showMessageBox({
                type: 'info',
                title: 'Up to Date',
                message: `Your application is up to date! Current version: ${currentVersion}`,
            });
        } else if (comparisonResult < 0) {
            console.log(`[INFO] Update available: Current (${currentVersion}) < Latest (${latestVersion})`);
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
            console.log(`[INFO] Newer version installed: Current (${currentVersion}) > Latest (${latestVersion})`);
            dialog.showMessageBox({
                type: 'info',
                title: 'Newer Version Installed',
                message: `You have a newer version (${currentVersion}) than the latest release on GitHub (${latestVersion}).`,
            });
        }
    } catch (error) {
        console.error('[ERROR] Failed to check for updates:', error.message);
        dialog.showMessageBox({
            type: 'error',
            title: 'Update Check Failed',
            message: `Failed to check for updates. Please try again later.\n\nError: ${error.message}`,
        });
    }
}

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

ipcMain.handle('getDownloadedFilesForDeveloper', async (event, developerName) => {
    if (!libraryFolder || !fs.existsSync(libraryFolder)) {
        console.error('[ERROR] Library folder is not set or does not exist. Please set it first.');
        throw new Error('Library folder is not set or does not exist.');
    }

    const downloadedDbPath = path.join(libraryFolder, 'downloaded.db');
    console.log('[DEBUG] downloaded.db path:', downloadedDbPath);

    if (!fs.existsSync(downloadedDbPath)) {
        console.error('[ERROR] downloaded.db does not exist:', downloadedDbPath);
        throw new Error('downloaded.db does not exist.');
    }

    const db = new sqlite3.Database(downloadedDbPath, sqlite3.OPEN_READONLY);
    return new Promise((resolve, reject) => {
        const query = `
            SELECT COUNT(*) as downloadedCount
            FROM Claims
            WHERE Dev_Name = ?;
        `;
        db.get(query, [developerName], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row.downloadedCount || 0);
            }
            db.close();
        });
    });
});

/**
 * Handles the 'fetch-developers' request.
 * Queries the database to retrieve the list of developers and their file counts.
 */
ipcMain.handle('fetch-developers', async (event, dbPath) => {
    console.log('[DEBUG] Handling fetch-developers request for path:', dbPath);

    if (!dbPath || !fs.existsSync(dbPath)) {
        const error = 'Invalid or missing database path.';
        console.error('[ERROR]', error);
        throw new Error(error);
    }

    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                console.error('[ERROR] Failed to open database:', err.message);
                reject(err);
            }
        });

        const query = `
            SELECT Dev_Name, COUNT(*) as totalFiles
            FROM Claims
            GROUP BY Dev_Name
            ORDER BY Dev_Name ASC;
        `;

        db.all(query, (err, rows) => {
            if (err) {
                console.error('[ERROR] Failed to fetch developers:', err.message);
                reject(err);
            } else {
                console.log(`[DEBUG] Retrieved ${rows.length} developers.`);
                resolve(rows);
            }
            db.close();
        });
    });
});

/**
 * Handles the 'fetch-files' request.
 * Queries the database to retrieve the list of files for a specific developer.
 * @param {string} devName - The name of the developer.
 */
ipcMain.handle('fetch-files', async (event, devName) => {
    console.log('[INFO] Handling fetch-files request.');
    
    // Validate the library folder and database path
    if (!libraryFolder || !fs.existsSync(libraryFolder)) {
        console.error('[ERROR] Library folder is not set or does not exist.');
        throw new Error('Library folder not set or does not exist.');
    }
    if (!dbPath || !fs.existsSync(dbPath)) {
        console.log('[DEBUG] Current appConfig:', appConfig);
        console.log('[DEBUG] Library Folder:', libraryFolder);
        console.log('[DEBUG] Database Path:', dbPath);
        console.error('[ERROR] No database loaded. Please load a database first.');
        throw new Error('No database loaded.');
    }

    // Open the database in read-only mode
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            console.error('[ERROR] Failed to open database:', err.message);
            throw new Error('Failed to open database.');
        }
    });

    return new Promise((resolve, reject) => {
        const query = `
            SELECT File_Name, Alt_File_Name, File_Claim_ID, File_URL, Alt_File_URL, File_Size, Dev_Name, 
                   Dev_Claim_ID, Release_Date, Media_Type, Description, Thumbnail_URL, File_Download_Name
            FROM Claims
            WHERE Dev_Name = ?
            ORDER BY Release_Date DESC;
        `;

        db.all(query, [devName], (err, rows) => {
            if (err) {
                console.error('[ERROR] Failed to fetch files:', err.message);
                reject(err);
            } else {
                console.log(`[INFO] Fetched ${rows.length} files for developer: ${devName}`);
                resolve(rows);
            }
            db.close();
        });
    });
});



ipcMain.handle('fetch-all-files', async () => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY); // Use the loaded database
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM Claims`, (err, rows) => {
            if (err) {
                console.error('[ERROR] Failed to fetch files from the loaded database:', err);
                reject(err);
            } else {
                console.log('[INFO] Retrieved files from the loaded database.');
                resolve(rows);
            }
        });
    });
});

ipcMain.handle('fetch-downloaded-file', async (event, fileName) => {
    if (!libraryFolder || !fs.existsSync(libraryFolder)) {
        console.error('[ERROR] Library folder is not set or does not exist.');
        throw new Error('Library folder is not set or does not exist.');
    }

    const downloadedDbPath = path.join(libraryFolder, 'downloaded.db');
    console.log('[DEBUG] Fetching file details from downloaded.db at:', downloadedDbPath);

    if (!fs.existsSync(downloadedDbPath)) {
        console.error('[ERROR] downloaded.db does not exist:', downloadedDbPath);
        throw new Error('downloaded.db does not exist.');
    }

    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(downloadedDbPath);

        const query = `
            SELECT File_Name, Alt_File_Name, File_Claim_ID, File_URL, Alt_File_URL, File_Size, Dev_Name, Dev_Claim_ID, Release_Date, Media_Type, Description, Thumbnail_URL, File_Path
            FROM Claims
            WHERE File_Name = ?;
        `;
        console.log('[DEBUG] Running query:', query);

        db.get(query, [fileName], (err, row) => {
            if (err) {
                console.error('[ERROR] Failed to query downloaded.db:', err.message);
                reject(err);
            } else if (!row) {
                console.error('[ERROR] No matching file found for:', fileName);
                resolve(null);
            } else {
                console.log('[INFO] File Path Retrieved:', row.File_Path);
                resolve(row.File_Path);
            }
            db.close();
        });
    });
});

ipcMain.handle('open-folder', async (event, folderPath) => {
    try {
        console.log(`[INFO] Opening folder: ${folderPath}`);
        const command = process.platform === 'win32' ? `explorer.exe "${folderPath}"` : `open "${folderPath}"`;
        exec(command, (error) => {
            if (error) {
                console.error(`[ERROR] Error opening folder: ${error.message}`);
                throw error;
            }
        });
    } catch (error) {
        console.error(`[ERROR] Error handling open-folder request: ${error.message}`);
        throw error;
    }
});

/**
 * Handles application exit when all windows are closed.
 */
app.on('window-all-closed', () => {
    console.log('[INFO] All windows closed. Exiting application.');
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Ensure proper cleanup on app quit
app.on('quit', () => {
    console.log('[INFO] App is quitting...');
    // Perform any necessary cleanup here (e.g., closing database connections)
});

/**
 * Handles application reactivation on macOS when no windows are open.
 */
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        console.log('[INFO] Activating new browser window.');
        mainWindow = new BrowserWindow();
    }
});

// Handle View File
ipcMain.handle('view-file', async (event, filePath) => {
    if (!filePath) {
        console.error('[ERROR] No file path provided.');
        return { success: false, message: 'No file path provided.' };
    }

    try {
        // Normalize the file path to handle OS-specific path issues
        const normalizedPath = path.normalize(filePath);

        // Check if the file exists
        if (!fs.existsSync(normalizedPath)) {
            console.error('[ERROR] File not found:', normalizedPath);
            return { success: false, message: 'File not found.' };
        }

        // Open the file's containing folder and highlight the file
        await shell.showItemInFolder(normalizedPath);
        console.log('[INFO] Opened folder for file:', normalizedPath);

        return { success: true };
    } catch (error) {
        console.error('[ERROR] Failed to view file:', error.message);
        return { success: false, message: error.message };
    }
});

ipcMain.handle('getLibraryFolder', () => {
    return global.libraryFolder || ''; // Return the library folder path
});

ipcMain.handle('get-All-Downloaded-Counts', async (event, developerNames) => {
    const downloadedDbPath = path.join(libraryFolder, 'downloaded.db');

    if (!fs.existsSync(downloadedDbPath)) {
        console.error('[ERROR] downloaded.db does not exist:', downloadedDbPath);
        return {};
    }

    const db = new sqlite3.Database(downloadedDbPath, sqlite3.OPEN_READONLY);

    return new Promise((resolve, reject) => {
        const placeholders = developerNames.map(() => '?').join(', ');
        const query = `
            SELECT Dev_Name, COUNT(*) AS count
            FROM Claims
            WHERE Dev_Name IN (${placeholders})
            GROUP BY Dev_Name
        `;

        db.all(query, developerNames, (err, rows) => {
            if (err) {
                console.error('[ERROR] Failed to fetch downloaded counts:', err.message);
                reject(err);
            } else {
                const counts = Object.fromEntries(rows.map((row) => [row.Dev_Name, row.count]));
                resolve(counts);
            }
            db.close();
        });
    });
});

ipcMain.handle('executeCommand', async (event, { command }) => {
    return new Promise((resolve, reject) => {
        exec(command, (err, stdout, stderr) => {
            if (err) {
                console.error(`[ERROR] Failed to execute command: ${command}`, stderr);
                reject(new Error(stderr));
            } else {
                console.log(`[INFO] Command executed successfully: ${command}`, stdout);
                resolve(stdout);
            }
        });
    });
});

ipcMain.handle('delete-file', async (event, filePath) => {
    try {
        console.log('[INFO] Deleting file and its folders:', filePath);

        // Delete the file from disk
        fs.unlinkSync(filePath);
        console.log('[INFO] File deleted:', filePath);

        // Get the file's containing folder
        const fileFolder = path.dirname(filePath);

        // Check if the file folder is empty
        if (fs.existsSync(fileFolder) && fs.readdirSync(fileFolder).length === 0) {
            fs.rmdirSync(fileFolder);
            console.log('[INFO] File folder deleted:', fileFolder);
        } else {
            console.log('[INFO] File folder not empty:', fileFolder);
        }

        // Get the developer folder (parent of file folder)
        const devFolder = path.dirname(fileFolder);

        // Check if the developer folder is empty
        if (fs.existsSync(devFolder) && fs.readdirSync(devFolder).length === 0) {
            fs.rmdirSync(devFolder);
            console.log('[INFO] Developer folder deleted:', devFolder);
        } else {
            console.log('[INFO] Developer folder not empty:', devFolder);
        }

        // Delete the file metadata from the database
        const downloadedDbPath = path.join(global.libraryFolder, 'downloaded.db');
        console.log('[DEBUG] downloaded.db path:', downloadedDbPath);

        const db = new sqlite3.Database(downloadedDbPath);

        db.run(
            `DELETE FROM Claims WHERE File_Path = ?`,
            [filePath],
            (err) => {
                if (err) {
                    console.error('[ERROR] Failed to delete file record from database:', err.message);
                    throw new Error('Failed to delete file record from database.');
                } else {
                    console.log('[INFO] File record deleted from database.');
                }
            }        );
        db.close();

        const devName = devFolder; // Helper function to extract dev name
        event.sender.send('update-developer-stats', devName);
        event.sender.send('update-developer-stats', 'ALL'); // Add this for the "ALL" view

        return { success: true };
    } catch (error) {
        console.error('[ERROR] Failed to delete file or folders:', error.message);
        return { success: false, message: error.message };
    }
});

ipcMain.handle('get-config', async () => {
    return appConfig; // Return the entire appConfig object
});

ipcMain.handle('fetch-files-by-developer', async (event, developerName) => {

    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT * FROM Claims WHERE Dev_Name = ?`,
            [developerName],
            (err, rows) => {
                if (err) {
                    console.error(`[ERROR] Failed to fetch files for developer "${developerName}":`, err);
                    reject(err);
                } else {
                    console.log(`[INFO] Retrieved ${rows.length} files for developer "${developerName}".`);
                    resolve(rows);
                }
            }
        );
    });
});

// Handle file download
const activeProcesses = new Map(); // Track active download processes by file name

ipcMain.handle('download-file', async (event, file) => {
    console.log('[DEBUG] download-file called with:', file);

    if (!global.libraryFolder) {
        const message = 'Library folder not set. Please set it first.';
        console.error('[ERROR]', message);
        event.sender.send('download-failed', message);
        event.sender.send('alert', message); // Notify the renderer process
        return;
    }

    console.log('[DEBUG] Global libraryFolder:', global.libraryFolder);

    const developerFolder = path.join(global.libraryFolder, file.Dev_Name || 'UnknownDeveloper');
    const fileFolder = path.join(developerFolder, file.Alt_File_Name || 'UnknownFile');
    const fileName = file.File_Download_Name || 'UnnamedFile';
    const finalFilePath = path.join(fileFolder, fileName);

    let statusEmitted = false; // Track if a status has been emitted for this file

    try {
        console.log('[DEBUG] Ensuring folders exist...');
        // Ensure developer and file folders exist
        fs.mkdirSync(developerFolder, { recursive: true });
        fs.mkdirSync(fileFolder, { recursive: true });

        // Path to lbrynet executable
        const lbrynetPath = path.join(appPath, 'utils', 'lbrynet.exe');
        if (!fs.existsSync(lbrynetPath)) {
            console.error('[ERROR] lbrynet.exe not found at:', lbrynetPath);
            throw new Error('lbrynet.exe missing');
        }

        console.log('[DEBUG] Executing lbrynet.exe...');
        // Spawn the download process
        const downloadProcess = spawn(lbrynetPath, [
            'get',
            file.Alt_File_URL || file.File_URL,
            `--file_name=${fileName}`,
            `--download_directory=${fileFolder}`,
        ]);

        // Log stdout and stderr from the download process
        downloadProcess.stdout.on('data', (data) => {
            const message = data.toString();
            logToFile(`[INFO] lbrynet stdout: ${message}`);
        });

        downloadProcess.stderr.on('data', (data) => {
            const message = data.toString();
            logToFile(`[ERROR] lbrynet stderr: ${message}`);
        });

        // Track active process for cancellation
        global.activeProcesses = global.activeProcesses || [];
        global.activeProcesses.push(downloadProcess.pid);

        downloadProcess.on('close', async (code) => {
            console.log(`[DEBUG] Download process exited with code: ${code}`);

            if (code === 0) {
                console.log(`[DEBUG] Verifying file existence for: ${file.File_Name}`);

                // Check if the file exists
                if (fs.existsSync(finalFilePath)) {
                    console.log('[INFO] File verified successfully:', finalFilePath);

                    if (!statusEmitted) {
                        event.sender.send('Trigger-counter', { status: 'downloaded', fileName: file.File_Name });
                        statusEmitted = true;
                    }

                    // Add to downloaded.db
                    const downloadedDbPath = path.join(global.libraryFolder, 'downloaded.db');
                    console.log('[DEBUG] downloaded.db path:', downloadedDbPath);

                    const db = new sqlite3.Database(downloadedDbPath);
                    console.log('[DEBUG] Ensuring database structure exists...');
                    await ensureDatabaseStructure(db);

                    db.run(
                        `INSERT INTO Claims (
                            File_Name, Alt_File_Name, File_Claim_ID, File_URL, Alt_File_URL, File_Size, Dev_Name,
                            Dev_Claim_ID, Release_Date, Media_Type, Description, Thumbnail_URL, File_Path
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            file.File_Name,
                            file.Alt_File_Name,
                            file.File_Claim_ID,
                            file.File_URL,
                            file.Alt_File_URL,
                            file.File_Size,
                            file.Dev_Name,
                            file.Dev_Claim_ID,
                            file.Release_Date,
                            file.Media_Type,
                            file.Description,
                            file.Thumbnail_URL,
                            finalFilePath,
                        ],
                        (err) => {
                            if (err) {
                                console.error('[ERROR] Failed to insert into database:', err);
                            } else {
                                console.log('[INFO] File added to database.');

                                // Send file-status-updated event here
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
                } else {
                    console.error('[ERROR] File does not exist after download:', finalFilePath);

                    if (!statusEmitted) {
                        event.sender.send('Trigger-counter', { status: 'failed', fileName: file.File_Name });
                        statusEmitted = true;
                    }

                    // Send file-status-updated event for failure
                    event.sender.send('file-status-updated', {
                        fileName: file.File_Name,
                        status: 'failed',
                    });

                    event.sender.send('update-developer-stats', file.Dev_Name);
                    event.sender.send('update-developer-stats', 'ALL');

                    // Clean up empty folders
                    cleanupFolders(fileFolder, developerFolder);
                }
            } else {
                console.error('[ERROR] Download failed for file:', file.File_Name);

                if (!statusEmitted) {
                    event.sender.send('Trigger-counter', { status: 'failed', fileName: file.File_Name });
                    statusEmitted = true;
                }

                // Send file-status-updated event for failure
                event.sender.send('file-status-updated', {
                    fileName: file.File_Name,
                    status: 'failed',
                });

                event.sender.send('update-developer-stats', file.Dev_Name);
                event.sender.send('update-developer-stats', 'ALL');

                // Clean up empty folders
                cleanupFolders(fileFolder, developerFolder);
            }

            // Remove process from activeProcesses
            global.activeProcesses = global.activeProcesses.filter(pid => pid !== downloadProcess.pid);
        });
    } catch (error) {
        console.error('[ERROR] Failed to download file:', error);

        if (!statusEmitted) {
            event.sender.send('Trigger-counter', { status: 'failed', fileName: file.File_Name });
            statusEmitted = true;
        }

        // Send file-status-updated event for failure
        event.sender.send('file-status-updated', {
            fileName: file.File_Name,
            status: 'failed',
        });

        event.sender.send('update-developer-stats', file.Dev_Name);
        event.sender.send('update-developer-stats', 'ALL');

        // Clean up empty folders
        cleanupFolders(fileFolder, developerFolder);
    }
});




// Utility function for cleanup
function cleanupFolders(fileFolder, developerFolder) {
    if (fs.existsSync(fileFolder) && fs.readdirSync(fileFolder).length === 0) {
        fs.rmdirSync(fileFolder);
        console.log('[INFO] Cleaned up empty file folder:', fileFolder);
    }

    if (fs.existsSync(developerFolder) && fs.readdirSync(developerFolder).length === 0) {
        fs.rmdirSync(developerFolder);
        console.log('[INFO] Cleaned up empty developer folder:', developerFolder);
    }
}


// IPC for killing active processes (for cancellation)
ipcMain.handle('kill-active-processes', async () => {
    console.log('[DEBUG] Killing active processes...');
    if (global.activeProcesses) {
        global.activeProcesses.forEach(pid => {
            try {
                process.kill(pid);
                console.log(`[INFO] Killed process with PID: ${pid}`);
            } catch (error) {
                console.error(`[ERROR] Failed to kill process with PID: ${pid}`, error);
            }
        });
        global.activeProcesses = [];
    }
});



ipcMain.handle('fetch-downloaded-files', async () => {
    if (!libraryFolder || !fs.existsSync(libraryFolder)) {
        console.error('[ERROR] Library folder is not set or does not exist.');
        throw new Error('Library folder is not set or does not exist.');
    }

    const downloadedDbPath = path.join(libraryFolder, 'downloaded.db');
    console.log('[DEBUG] Fetching downloaded files from downloaded.db at:', downloadedDbPath);

    if (!fs.existsSync(downloadedDbPath)) {
        console.error('[ERROR] downloaded.db does not exist:', downloadedDbPath);
        return [];
    }

    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(downloadedDbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                console.error('[ERROR] Failed to open downloaded.db:', err.message);
                reject(err);
            }
        });

        const query = `SELECT File_Name FROM Claims WHERE File_Path IS NOT NULL`;
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error('[ERROR] Failed to query downloaded.db:', err.message);
                reject(err);
            } else {
                const downloadedFiles = rows.map((row) => row.File_Name);
                console.log('[DEBUG] Retrieved downloaded files:', downloadedFiles.length);
                resolve(downloadedFiles); // Return the list of downloaded files
            }
            db.close();
        });
    });
});

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
                File_Path TEXT
            )`,
            (err) => {
                if (err) {
                    console.error('[ERROR] Failed to ensure database structure:', err);
                    reject(err);
                } else {
                    console.log('[INFO] Database structure ensured.');
                    resolve();
                }
            }
        );
    });
}

ipcMain.handle('fetch-downloaded-count', async (event, devName) => {
    const dbPath = path.join(libraryFolder, 'downloaded.db');
    const query = devName === 'ALL'
        ? `SELECT COUNT(*) as downloadedCount FROM Claims WHERE File_Path IS NOT NULL`
        : `SELECT COUNT(*) as downloadedCount FROM Claims WHERE Dev_Name = ? AND File_Path IS NOT NULL`;

    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
        db.get(query, devName === 'ALL' ? [] : [devName], (err, row) => {
            if (err) {
                console.error('[ERROR] Failed to fetch downloaded count:', err);
                reject(err);
            } else {
                resolve(row.downloadedCount || 0);
            }
            db.close();
        });
    });
});

ipcMain.handle('check-multiple-file-statuses', async (event, fileNames) => {
    if (!libraryFolder || !fs.existsSync(libraryFolder)) {
        console.error('[ERROR] Library folder is not set or does not exist.');
        throw new Error('Library folder is not set or does not exist.');
    }

    const downloadedDbPath = path.join(libraryFolder, 'downloaded.db');
    console.log('[DEBUG] Checking file statuses in downloaded.db at:', downloadedDbPath);

    if (!fs.existsSync(downloadedDbPath)) {
        console.error('[ERROR] downloaded.db does not exist:', downloadedDbPath);
        return {};
    }

    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(downloadedDbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                console.error('[ERROR] Failed to open downloaded.db:', err.message);
                return reject(err);
            }
        });

        // Prepare the query for multiple file names
        const placeholders = fileNames.map(() => '?').join(',');
        const query = `SELECT File_Name FROM Claims WHERE File_Name IN (${placeholders})`;

        db.all(query, fileNames, (err, rows) => {
            if (err) {
                console.error('[ERROR] Failed to query downloaded.db:', err.message);
                reject(err);
            } else {
                // Map file names to existence status
                const statuses = fileNames.reduce((acc, fileName) => {
                    acc[fileName] = rows.some((row) => row.File_Name === fileName);
                    return acc;
                }, {});
                resolve(statuses);
            }
            db.close();
        });
    });
});

module.exports = { logToFile };