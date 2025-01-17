const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

const appPath = process.resourcesPath || __dirname;

contextBridge.exposeInMainWorld('api', {
    onReloadData: (callback) => {
        ipcRenderer.on('reload-data', callback);},
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    removeListener: (channel, callback) => ipcRenderer.removeListener(channel, callback),
    on: (channel, callback) => {
        ipcRenderer.on(channel, (event, ...args) => callback(...args));
    },
    emit: (channel, ...args) => ipcRenderer.send(channel, ...args),

    // Path utilities
    path: {
        join: (...args) => path.join(...args),
        resolve: (...args) => path.resolve(...args),
        dirname: (filepath) => path.dirname(filepath),
        basename: (filepath) => path.basename(filepath),
        extname: (filepath) => path.extname(filepath),
    },

    // Core IPC handlers
    selectLibraryFolder: () => ipcRenderer.invoke('select-library-folder'),
    notifyLibraryFolderSelected: (folder) => ipcRenderer.send('library-folder-selected', folder),
    getLibraryFolder: () => ipcRenderer.invoke('getLibraryFolder'),
    cleanTempFolders: async () => ipcRenderer.invoke('clean-temp-folders'),
    markFileAsNotNew: (fileClaimId) => ipcRenderer.invoke('mark-file-as-not-new', fileClaimId),
    getNewFileCountForDeveloper: (developerName) => ipcRenderer.invoke('get-new-file-count', developerName),
    logToFile: (message) => ipcRenderer.invoke('log-to-file', message),
    
    // Query database handlers
    fetchDevelopers: () => ipcRenderer.invoke('fetch-developers'),
    fetchAllFiles: () => ipcRenderer.invoke('query-database', 'fetchAllFiles'),
    fetchDownloadedFiles: () => ipcRenderer.invoke('query-database', 'fetchDownloadedFiles'),
    fetchDownloadedCount: (devName) => ipcRenderer.invoke('query-database', 'fetchFilesByDeveloper', { devName }),
    fetchFilesByDeveloper: (devName) => ipcRenderer.invoke('query-database', 'fetchFilesByDeveloper', { devName }),
    searchFiles: (searchTerm) => ipcRenderer.invoke('query-database', 'searchFiles', { searchTerm }),
    checkMultipleFileStatuses: (fileNames) => ipcRenderer.invoke('check-multiple-file-statuses', fileNames),
    onDatabaseLoaded: (callback) => ipcRenderer.on('database-loaded', callback),
    getAllDownloadedCounts: (developerNames) => ipcRenderer.invoke('getAllDownloadedCounts', developerNames),
    getDownloadedFilesForDeveloper: (developerName) => ipcRenderer.invoke('get-downloaded-files-for-developer', developerName),
    getAllDeveloperCounts: () => ipcRenderer.invoke('getAllDeveloperCounts'),

    // File management
    fetchDownloadedFile: (fileName) => ipcRenderer.invoke('fetch-downloaded-file', fileName),
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
    openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
    viewFile: (filePath) => ipcRenderer.invoke('view-file', filePath),
    downloadFile: (file) => ipcRenderer.invoke('download-file', file),
    killActiveProcesses: () => ipcRenderer.invoke('kill-active-processes'),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    scanFolder: (folderPath) => ipcRenderer.invoke('scan-folder', folderPath),
    processScannedFiles: (files, action) => ipcRenderer.invoke('process-scanned-files', { files, action }),
    getLibraryFolder: () => ipcRenderer.invoke('get-library-folder'),

    // Config and settings
    getConfig: () => ipcRenderer.invoke('get-config'),
    saveSetting: (key, value) => ipcRenderer.send('save-setting', { key, value }),
    getSetting: (key) => ipcRenderer.invoke('get-setting', key),

    // Event bridging
    onTriggerCounter: (callback) => {
        ipcRenderer.on('Trigger-counter', (event, data) => {
            console.log(`[DEBUG] Trigger-counter bridged to renderer: fileName=${data.fileName}, status=${data.status}`);
            callback(data);
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
