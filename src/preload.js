const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// Determine the app base path (packaged vs. development)
const appPath = process.resourcesPath || __dirname;

// Expose methods to the renderer process
contextBridge.exposeInMainWorld(('api'), {
    logToFile: (message) => {
        try {
            const logFile = path.join(appPath, 'app.log');
            const logMessage = `[${new Date().toISOString()}] ${message}\n`;
            fs.appendFileSync(logFile, logMessage);
        } catch (error) {
            console.error('[ERROR] Failed to write to log file:', error.message);
        }
    },
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, callback) => {
        ipcRenderer.on(channel, (event, ...args) => callback(...args));
    },
    emit: (channel, ...args) => ipcRenderer.send(channel, ...args),

    path: {
        join: (...args) => path.join(...args),
        resolve: (...args) => path.resolve(...args),
        dirname: (filepath) => path.dirname(filepath),
        basename: (filepath) => path.basename(filepath),
        extname: (filepath) => path.extname(filepath),
    },
    
    getAllDownloadedCounts: async (developerNames) => {return ipcRenderer.invoke('get-All-Downloaded-Counts', developerNames);},
    killActiveProcesses: () => ipcRenderer.invoke('kill-active-processes'),
    checkMultipleFileStatuses: (fileNames) => ipcRenderer.invoke('check-multiple-file-statuses', fileNames),
    getLibraryFolder: () => ipcRenderer.invoke('getLibraryFolder'),
    executeCommand: (command) => ipcRenderer.invoke('executeCommand', { command }),
    loadDatabase: () => ipcRenderer.invoke('load-database'),
    fetchDevelopers: (dbPath) => ipcRenderer.invoke('fetch-developers', dbPath),
    fetchFilesByDeveloper: (devName) => ipcRenderer.invoke('fetch-files-by-developer', devName),
    fetchDownloadedCount: (devName) => ipcRenderer.invoke('fetch-downloaded-count', devName),
    fetchFiles: (dbPath, devName) => ipcRenderer.invoke('fetch-files', dbPath, devName),
    fetchAllFiles: () => ipcRenderer.invoke('fetch-all-files'),
    fetchDownloadedFiles: () => ipcRenderer.invoke('fetch-downloaded-files'),
    fetchDownloadedFile: (fileName) => ipcRenderer.invoke('fetch-downloaded-file', fileName),
    setLibraryFolder: () => ipcRenderer.invoke('set-library-folder'),
    downloadFile: (file) => ipcRenderer.invoke('download-file', file),
    viewFile: (filePath) => ipcRenderer.invoke('view-file', filePath),
    deleteFile: (file) => ipcRenderer.invoke('delete-file', file),
    onAlert: (callback) => ipcRenderer.on('alert', (event, message) => callback(message)),
    getDownloadedFilePath: (fileName) => ipcRenderer.invoke('getDownloadedFilePath', fileName),
    getConfig: () => ipcRenderer.invoke('get-config'),
    getDownloadedFilesForDeveloper: (developerName) => ipcRenderer.invoke('getDownloadedFilesForDeveloper', developerName),
    openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
    onDatabaseLoaded: (callback) => ipcRenderer.on('database-loaded', (event, dbPath) => callback(dbPath)),

    // Bridging Trigger-counter
    onTriggerCounter: (callback) => {
        ipcRenderer.on('Trigger-counter', (event, data) => {
            console.log(`[DEBUG] Trigger-counter bridged to renderer: fileName=${data.fileName}, status=${data.status}`);
            callback(data); // Pass the data object directly to the callback
        });
    },
    
});

contextBridge.exposeInMainWorld('lbrynet', {
    onStatusUpdate: (callback) => {
        ipcRenderer.on('lbrynet-status', (_, status) => callback(status));
    },
    startStatusUpdates: () => ipcRenderer.send('start-status-updates'),
    stopStatusUpdates: () => ipcRenderer.send('stop-status-updates'),
});