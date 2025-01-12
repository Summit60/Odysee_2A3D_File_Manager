////// Logging for Renderer Initialization
console.log('[INFO] renderer.js loaded and running')

////// DOM Elements
const divider = document.getElementById('divider');
const developerSection = document.getElementById('developer-section');
const fileSection = document.getElementById('file-section');
const developerList = document.getElementById('developer-list');
const fileList = document.getElementById('file-list');
const fileCount = document.getElementById('file-count');
const fileSize = document.getElementById('file-size');
const searchDevelopersInput = document.getElementById('search-developers');
const searchFilesInput = document.getElementById('search-files');

/////// State
let selectedFiles = [];
let downloadedFilesSet = new Set();
let totalSize = 0;
let isDragging = false;
let cancelDownloads = false; // Track cancel state
let currentDeveloper = null; // Tracks the selected developer

/////// Event Listeners

// Mouse down on the divider
divider.addEventListener('mousedown', (e) => {
    isDragging = true;
    document.body.style.cursor = 'ew-resize';
});

// Mouse move to resize
document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    // Calculate new width for developer section
    const contentRect = document.getElementById('content').getBoundingClientRect();
    const newWidth = e.clientX - contentRect.left;

    // Apply new widths
    developerSection.style.flex = `0 0 ${newWidth}px`;
    fileSection.style.flex = `0 0 calc(100% - ${newWidth}px - 5px)`; // Account for divider width
});

// Mouse up to stop dragging
document.addEventListener('mouseup', () => {
    if (isDragging) {
        isDragging = false;
        document.body.style.cursor = 'default';
    }
});

//////// Search Inputs

// Filter Developers
searchDevelopersInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const developers = developerList.querySelectorAll('.developer-item'); // Assuming developer items have this class

    developers.forEach((dev) => {
        const devName = dev.textContent.toLowerCase();
        if (devName.includes(query)) {
            dev.style.display = ''; // Show the developer
        } else {
            dev.style.display = 'none'; // Hide the developer
        }
    });
});

// Debounce utility
function debounce(func, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), delay);
    };
}

// Centralized debounced function for refreshing the file list
const debouncedRefreshFileList = debounce(async () => {
    console.log('[INFO] Debounced search triggered. Refreshing file list...');
    await refreshFileList(); // Call the refresh function after the debounce delay
}, 300); // Adjust delay as needed (300ms in this case)

// Toggle Button Logic
const toggleViewModeButton = document.getElementById('toggle-view-mode');
let isViewingDownloaded = false; // Tracks if the "View Downloaded" filter is active


// Function to refresh the developer list
function refreshDeveloperList() {
    const developerItems = document.querySelectorAll('.developer-item');

    developerItems.forEach((devItem) => {
        const devName = devItem.dataset.devName;
        const downloadedCount = parseInt(devItem.querySelector('.downloaded-column').textContent, 10) || 0;

        // Check if the developer matches the toggle and search criteria
        const matchesToggle = !isViewingDownloaded || downloadedCount > 0;
        const matchesSearch = devName.toLowerCase().includes(searchDevelopersInput.value.toLowerCase());

        devItem.style.display = matchesToggle && matchesSearch ? '' : 'none';
    });

    console.log('[INFO] Developer list refreshed based on toggle and search.');
}

// Debounce function to delay execution
function debounce(func, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout); // Clear previous timeout
        timeout = setTimeout(() => func(...args), delay); // Set new timeout
    };
}

// Preloaded files for the current developer or all
let preloadedFiles = [];

// Separate logic for refreshing the file list when toggling views or searching
async function refreshFileList() {
    try {
        let files;

        // Fetch files based on the current developer selection
        if (currentDeveloper === 'ALL') {
            console.log('[INFO] Refreshing all files from the database.');
            files = [...preloadedFiles];
        } else {
            console.log(`[INFO] Refreshing files for developer: ${currentDeveloper}`);
            files = await window.api.fetchFilesByDeveloper(currentDeveloper);
        }

        // Apply "View Downloads Only" filter
        if (isViewingDownloaded) {
            files = files.filter((file) => file.isDownloaded);
        }

        // Apply the file search filter
        const fileSearchQuery = searchFilesInput.value.toLowerCase();
        if (fileSearchQuery) {
            console.log(`[DEBUG] Applying file search filter: "${fileSearchQuery}"`);
            files = files.filter((file) =>
                file.File_Name.toLowerCase().includes(fileSearchQuery)
            );
        }

        console.log(`[DEBUG] Total Filtered Files: ${files.length}`);
        loadFiles(files); // Load filtered files into the UI
    } catch (err) {
        console.error('[ERROR] Failed to refresh file list:', err);
    }
}


// Integrate search bar filtering with the toggle logic
searchDevelopersInput.addEventListener('input', () => {
    refreshDeveloperList(); // Ensure developer search integrates with toggling
});


////// Top Bar Button Handlers


// Function to initialize the download process
const initializeDownload = () => {
    document.getElementById('download-selected').addEventListener('click', async () => {
        const maxConcurrentDownloads = 5;
        const progressBar = document.getElementById('progress-bar');
        const progressStatus = document.getElementById('progress-status');
        const cancelButton = document.getElementById('cancel-downloads');
        const totalFiles = selectedFiles.length;

        if (totalFiles === 0) {
            alert('No files selected for download.');
            console.log('[DEBUG] No files selected.');
            return;
        }

        // Reset tracking variables
        cancelDownloads = false;
        completedFiles = new Set();
        failedFiles = [];
        activeDownloads = [];
        downloadQueue = selectedFiles.slice();

        // Initialize progress bar
        progressBar.value = 0;
        progressBar.max = totalFiles;
        progressStatus.textContent = `Progress: 0/${totalFiles} (0%)`;

        let dialogVisible = false; // Prevent multiple dialogs

        const updateProgress = () => {
            const processedFilesCount = completedFiles.size + failedFiles.length;
            const percentage = ((processedFilesCount / totalFiles) * 100).toFixed(2);
            progressBar.value = processedFilesCount;
            progressStatus.textContent = `Progress: ${processedFilesCount}/${totalFiles} (${percentage}%)`;
            console.log(`[DEBUG] Progress updated: ${processedFilesCount}/${totalFiles} (${percentage}%)`);
        };

        const cleanupIncompleteDownloads = () => {
            downloadQueue.forEach(file => {
                const developerFolder = path.join(global.libraryFolder, file.Dev_Name || 'UnknownDeveloper');
                const fileFolder = path.join(developerFolder, file.File_Name || 'UnknownFile');
                if (fs.existsSync(fileFolder) && fs.readdirSync(fileFolder).length === 0) {
                    fs.rmdirSync(fileFolder);
                    console.log('[INFO] Cleaned up incomplete file folder:', fileFolder);
                }
                if (fs.existsSync(developerFolder) && fs.readdirSync(developerFolder).length === 0) {
                    fs.rmdirSync(developerFolder);
                    console.log('[INFO] Cleaned up empty developer folder:', developerFolder);
                }
            });
        };

        const cancelDownloadsImmediately = async () => {
            cancelDownloads = true;
            console.log('[INFO] Cancelling downloads...');
            await window.api.killActiveProcesses(); // Custom function to kill all active processes
            activeDownloads = [];
            downloadQueue = [];
            cleanupIncompleteDownloads();
        };

        const removeExistingDialog = (dialogId) => {
            const existingDialog = document.getElementById(dialogId);
            if (existingDialog) {
                console.log('[DEBUG] Removing existing dialog:', dialogId);
                document.body.removeChild(existingDialog);
            }
        };        
        
        const showFinalDialog = () => {
            if (dialogVisible) return;
        
            const dialogId = 'final-dialog';
            removeExistingDialog(dialogId); // Ensure no overlapping dialogs
        
            dialogVisible = true;
        
            const modal = document.createElement('div');
            modal.id = dialogId; // Assign unique ID to the dialog
            modal.classList.add('modal');
            Object.assign(modal.style, {
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                background: 'white',
                border: '1px solid #ccc',
                padding: '20px',
                width: '400px',
                maxHeight: '300px',
                overflowY: 'auto',
                zIndex: 1000,
            });
        
            const closeButtonId = `close-modal-${Date.now()}`;
            if (failedFiles.length === 0) {
                modal.innerHTML = `
                    <h3>Downloads Complete</h3>
                    <p>All files were downloaded successfully!</p>
                    <button id="${closeButtonId}" style="margin-top: 10px;">Close</button>
                `;
            } else {
                modal.innerHTML = `
                    <h3>Downloads Complete</h3>
                    <p>
                        Some downloads failed: "Unfortunately, sometimes the database picks up files that no longer exist. 
                        It may be worth navigating the seas to find the treasure you seek." - Summit60
                    </p>
                    <p>The following files could not be downloaded:</p>
                    <ul>
                        ${failedFiles.map(file => `<li>${file.File_Name}</li>`).join('')}
                    </ul>
                    <button id="${closeButtonId}" style="margin-top: 10px;">Close</button>
                `;
            }
        
            document.body.appendChild(modal);
        
            document.getElementById(closeButtonId).addEventListener('click', () => {
                const dialogElement = document.getElementById(dialogId);
                if (dialogElement) {
                    document.body.removeChild(dialogElement); // Remove dialog from DOM
                }
                dialogVisible = false; // Reset dialog visibility flag
                failedFiles = []; // Clear failed files
                console.log('[DEBUG] Final dialog closed and failedFiles reset.');
            }, { once: true });
        };        

        const showCancelDialog = () => {
            const dialogId = 'cancel-dialog';
            removeExistingDialog(dialogId); // Ensure no overlapping dialogs
        
            const modal = document.createElement('div');
            modal.id = dialogId; // Assign unique ID to the dialog
            modal.classList.add('modal');
            Object.assign(modal.style, {
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                background: 'white',
                border: '1px solid #ccc',
                padding: '20px',
                width: '300px',
                zIndex: 1000,
            });
        
            const closeButtonId = `cancel-close-modal-${Date.now()}`;
            modal.innerHTML = `
                <h3>Downloads Canceled</h3>
                <p>All ongoing downloads have been canceled.</p>
                <button id="${closeButtonId}" style="margin-top: 10px;">Close</button>
            `;
        
            document.body.appendChild(modal);
        
            document.getElementById(closeButtonId).addEventListener('click', () => {
                const dialogElement = document.getElementById(dialogId);
                if (dialogElement) {
                    document.body.removeChild(dialogElement); // Remove dialog from DOM
                }
                console.log('[DEBUG] Cancel dialog closed.');
            }, { once: true });
        };        

        const finalizeDownloads = () => {
            const processedFilesCount = completedFiles.size + failedFiles.length;
        
            if (processedFilesCount === totalFiles) {
                console.log(`[INFO] All files processed. ${failedFiles.length} failures.`);
        
                // Clear the selectedFiles array
                selectedFiles = [];
                console.log('[DEBUG] Cleared selectedFiles array after processing. Current contents:', selectedFiles);
        
                // Reset the UI (if needed, e.g., buttons, progress, etc.)
                updateFileStats(); // Recalculate stats for the top bar
                showFinalDialog(); // Show the final dialog
                document.querySelectorAll('.select-btn').forEach((btn) => {
                    btn.textContent = 'Select';});
            }
        };
        

        window.api.onTriggerCounter(({ fileName, status }) => {
            console.log(`[DEBUG] Trigger-counter received in renderer: fileName=${fileName}, status=${status}`);
        
            if (status === 'downloaded') {
                completedFiles.add(fileName);
            } else if (status === 'failed') {
                if (!failedFiles.some(f => f.File_Name === fileName)) {
                    const file = selectedFiles.find(f => f.File_Name === fileName);
                    if (file) {
                        failedFiles.push(file);
                        console.log('[DEBUG] Failed file added to array:', failedFiles);
                    }
                }
            }
            
            updateProgress();
            finalizeDownloads();
        });       

        const startDownload = async () => {
            while (downloadQueue.length > 0 && activeDownloads.length < maxConcurrentDownloads) {
                if (cancelDownloads) {
                    console.log('[INFO] Download queue cleared due to cancellation.');
                    downloadQueue.length = 0;
                    return;
                }

                const file = downloadQueue.shift();
                const downloadPromise = window.api
                    .downloadFile(file)
                    .then(response => {
                        if (response.status === 'verified') {
                            window.api.emit('Trigger-counter', { fileName: file.File_Name, status: 'downloaded' });
                        } else {
                            window.api.emit('Trigger-counter', { fileName: file.File_Name, status: 'failed' });
                        }
                    })
                    .catch(() => {
                        window.api.emit('Trigger-counter', { fileName: file.File_Name, status: 'failed' });
                    })
                    .finally(() => {
                        activeDownloads.splice(activeDownloads.indexOf(downloadPromise), 1);
                        if (!cancelDownloads) startDownload();
                    });

                activeDownloads.push(downloadPromise);
            }
        };

        startDownload();

        if (cancelButton && !cancelButton.dataset.listenerAdded) {
            cancelButton.addEventListener('click', () => {
                cancelDownloads = true;
                console.log('[INFO] Downloads canceled.');
                cancelDownloadsImmediately();
                showCancelDialog();
            });
            cancelButton.dataset.listenerAdded = 'true';
        }
    });
};



document.addEventListener('DOMContentLoaded', () => {
    const statusModal = document.getElementById('status-modal');
    const blocksRemainingElement = document.getElementById('status-blocksBehind');

    function closeStatusModal() {
        if (!statusModal) {
            console.error('[ERROR] Modal element not found.');
            return;
        }

        statusModal.style.opacity = 0; // Fade out
        setTimeout(() => {
            statusModal.style.display = 'none'; // Hide modal
            console.log('[DEBUG] Modal closed.');
        }, 500); // Match the CSS transition duration
    }

    if (window.lbrynet && typeof window.lbrynet.onStatusUpdate === 'function') {
        window.lbrynet.onStatusUpdate((status) => {
            console.log('[DEBUG] Received lbrynet-status update:', status);

            let blocksBehind = null;

            if (typeof status === 'object' && status.blocksBehind !== undefined) {
                blocksBehind = status.blocksBehind;
            } else if (typeof status === 'string') {
                if (status === 'Synchronization complete.') {
                    console.log('[DEBUG] Synchronization complete. Closing modal.');
                    closeStatusModal();
                    return;
                }

                const match = status.match(/Syncing blockchain: (\d+) blocks remaining/);
                if (match) {
                    blocksBehind = parseInt(match[1], 10);
                }
            }

            if (blocksBehind !== null) {
                blocksRemainingElement.textContent = `Blocks Remaining: ${blocksBehind}`;
                console.log(`[DEBUG] Updated blocks remaining: ${blocksBehind}`);

                if (blocksBehind === 0) {
                    console.log('[DEBUG] blocksBehind is 0. Closing modal...');
                    closeStatusModal();
                }
            } else {
                console.error('[ERROR] Unable to parse blocksBehind from status:', status);
            }
        });
    } else {
        console.error('[ERROR] lbrynet API is not available in the renderer.');
    }
});




// Initialize the download functionality
document.addEventListener('DOMContentLoaded', initializeDownload); 

// Helper function to construct the file path for a given file
const getFilePath = (file) => {
    const libraryFolder = window.api.getLibraryFolder(); // Ensure you expose this in preload
    if (!libraryFolder) {
        throw new Error('[ERROR] Library folder is not set.');
    }
    return window.api.path.join(
        libraryFolder,
        file.Dev_Name || 'UnknownDeveloper',
        file.File_Name || 'UnnamedFile'
    );
};

// Helper function to construct the folder path for a given file
const getFolderPath = (file) => {
    const libraryFolder = window.api.getLibraryFolder(); // Ensure you expose this in preload
    if (!libraryFolder) {
        throw new Error('[ERROR] Library folder is not set.');
    }
    return window.api.path.join(libraryFolder, file.Dev_Name || 'UnknownDeveloper');
};



function updateFileStats() {
    const selectedCount = document.getElementById('selected-count');
    const selectedSize = document.getElementById('selected-size');

    // Dynamically calculate the total size from selectedFiles
    const totalSize = selectedFiles.reduce((acc, file) => acc + (file.File_Size || 0), 0);

    const sizeInMB = (totalSize / 1024 / 1024).toFixed(2);
    const sizeInGB = (totalSize / 1024 / 1024 / 1024).toFixed(2);
    const sizeInTB = (totalSize / 1024 / 1024 / 1024 / 1024).toFixed(2);

    let formattedSize = `${sizeInMB} MB`;
    if (totalSize >= 1024 ** 3) formattedSize = `${sizeInGB} GB`;
    if (totalSize >= 1024 ** 4) formattedSize = `${sizeInTB} TB`;

    selectedCount.textContent = `Selected Files: ${selectedFiles.length}`;
    selectedSize.textContent = `Total Size: ${formattedSize}`;

    console.log(`[INFO] Updated file stats: ${selectedFiles.length} files, ${totalSize} bytes.`);
}


document.addEventListener('DOMContentLoaded', () => {
    console.log(document.body.innerHTML);
    console.log('[INFO] renderer.js loaded and running');

    const developerSection = document.getElementById('developer-section');
    const divider = document.getElementById('divider');
    const selectAllBtn = document.getElementById('select-all');
    const selectNoAudioVideoBtn = document.getElementById('select-no-audio-video');
    const deselectAllBtn = document.getElementById('deselect-all');

    let isResizing = false;

    divider.addEventListener('mousedown', (event) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize'; // Change cursor during resizing
    });

    document.addEventListener('mousemove', (event) => {
        if (!isResizing) return;

        // Calculate the new width for the developer section
        const offsetRight = document.body.offsetWidth - (event.clientX - developerSection.offsetLeft);
        const newWidth = document.body.offsetWidth - offsetRight;

        // Clamp the new width between 20% and 50% of the window width
        if (newWidth >= window.innerWidth * 0.2 && newWidth <= window.innerWidth * 0.5) {
            developerSection.style.width = `${newWidth}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = 'default'; // Reset cursor
        }
    });
    const cancelDownloadsButton = document.getElementById('cancel-downloads');
    if (cancelDownloadsButton) {
        cancelDownloadsButton.addEventListener('click', () => {
            cancelDownloads = true; // Set cancel state
            console.log('[INFO] canceled selected.');
            console.log('[INFO]canceled selected.');
        });
    } else {
        console.log('[ERROR] Cancel Downloads button not found in the DOM.');
    }

    // Handle "Select All" button click
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', async () => {
            try {
                const allFiles = await window.api.fetchAllFiles(); // Fetch all files from the loaded database
                selectedFiles = allFiles.slice(); // Clone all files into selectedFiles
                totalSize = selectedFiles.reduce((sum, file) => sum + file.File_Size, 0);

                // Update all developer checkboxes programmatically
                const developerCheckboxes = document.querySelectorAll('.developer-item input[type="checkbox"]');
                developerCheckboxes.forEach((checkbox) => {
                    checkbox.checked = true; // Check the box
                });

                updateFileStats();
                console.log('[INFO] All files selected for download.');
            } catch (error) {
                console.log('[ERROR] Failed to select all files:', error);
            }
        });
    }

    // Handle "Select All No Audio/Video" button click
    if (selectNoAudioVideoBtn) {
        selectNoAudioVideoBtn.addEventListener('click', async () => {
            try {
                const allFiles = await window.api.fetchAllFiles(); // Correct API call to fetch all files
                // Filter out files with Media_Type starting with 'audio/' or 'video/'
                selectedFiles = allFiles.filter(file => {
                    const mediaType = file.Media_Type?.toLowerCase() || ''; // Safely handle null/undefined and ensure lowercase
                    return !mediaType.startsWith('video/') && !mediaType.startsWith('audio/');
                });
                
                totalSize = selectedFiles.reduce((sum, file) => sum + file.File_Size, 0);

                // Update stats
                updateFileStats();

                console.log('[INFO] Files without audio/video selected for download.');
            } catch (error) {
                console.log('[ERROR] Failed to select no audio/video files:', error);
            }
        });
    }

    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
            selectedFiles = [];
            totalSize = 0;
    
            // Uncheck all developer checkboxes programmatically
            const developerCheckboxes = document.querySelectorAll('.developer-item input[type="checkbox"]');
            developerCheckboxes.forEach((checkbox) => {
                checkbox.checked = false; // Uncheck the box
            });
            document.querySelectorAll('.select-btn').forEach((btn) => {
                btn.textContent = 'Select';});

            updateFileStats(); // Update file count and size
            console.log('[INFO] All files deselected.');
        });
    }

     // Handle developer checkbox clicks
     const developerList = document.getElementById('developer-list');
     if (developerList) {
         developerList.addEventListener('change', async (event) => {
             const checkbox = event.target;
             if (checkbox.classList.contains('developer-checkbox')) {
                 const devName = checkbox.getAttribute('data-dev-name');
 
                 if (checkbox.checked) {
                     try {
                         const files = await window.api.fetchFilesByDeveloper(devName);
                         selectedFiles.push(...files); // Add all files from the developer
                         totalSize += files.reduce((sum, file) => sum + file.File_Size, 0);
                     } catch (error) {
                         console.log(`[ERROR] Failed to fetch files for developer ${devName}:`, error);
                     }
                 } else {
                     // Remove all files from the developer
                     selectedFiles = selectedFiles.filter((file) => file.Dev_Name !== devName);
                     totalSize = selectedFiles.reduce((sum, file) => sum + file.File_Size, 0);
                 }
 
                 updateFileStats(); // Update file count and size
             }
         });
     }
});

//////// UI Updates

//Populates the developer list with data fetched from the database.
//@param {Array} developers - List of developers from the database.
async function loadDevelopers(developers) {
    const developerList = document.getElementById('developer-list');
    developerList.innerHTML = ''; // Clear existing entries

    const developerNames = developers.map((dev) => dev.Dev_Name);
    let totalFiles = developers.reduce((sum, dev) => sum + (dev.totalFiles || 0), 0);

    // Fetch all downloaded counts in one API call
    let downloadedCounts = {};
    try {
        downloadedCounts = await window.api.getAllDownloadedCounts(developerNames); // Batch fetch
    } catch (err) {
        console.log(`[ERROR] Failed to fetch downloaded counts: ${err.message}`);
    }

    let totalDownloadedFiles = 0;
    const fragment = document.createDocumentFragment();

    developers.forEach((developer) => {
        const downloadedCount = downloadedCounts[developer.Dev_Name] || 0;
        totalDownloadedFiles += downloadedCount;

        const devElement = document.createElement('div');
        devElement.classList.add('developer-item');
        devElement.dataset.devName = developer.Dev_Name;

        // Left: Name and Checkbox
        const leftDiv = document.createElement('div');
        leftDiv.style.display = 'flex';
        leftDiv.style.alignItems = 'center';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'developer-checkbox';
        checkbox.dataset.devName = developer.Dev_Name;

        const nameDiv = document.createElement('div');
        nameDiv.textContent = developer.Dev_Name;
        nameDiv.style.marginLeft = '10px';

        leftDiv.appendChild(checkbox);
        leftDiv.appendChild(nameDiv);

        // Right: Stats
        const statsDiv = document.createElement('div');
        statsDiv.style.display = 'flex';
        statsDiv.style.marginLeft = 'auto';
        statsDiv.style.gap = '20px';

        const totalFilesDiv = document.createElement('div');
        totalFilesDiv.textContent = developer.totalFiles || 0;

        const downloadedCountDiv = document.createElement('div');
        downloadedCountDiv.className = 'downloaded-column';
        downloadedCountDiv.textContent = downloadedCount;

        statsDiv.appendChild(totalFilesDiv);
        statsDiv.appendChild(downloadedCountDiv);

        checkbox.addEventListener('click', (e) => e.stopPropagation());

        checkbox.addEventListener('change', async (e) => {
            e.stopImmediatePropagation();

            if (e.target.checked) {
                console.log(`[INFO] Selected developer: ${developer.Dev_Name}`);
                const files = await window.api.fetchFilesByDeveloper(developer.Dev_Name);

                selectedFiles.push(...files);
                selectedFiles = [...new Map(selectedFiles.map(file => [file.File_Name, file])).values()];
                console.log(`[INFO] Updated selected files:`, selectedFiles);
            } else {
                console.log(`[INFO] Deselected developer: ${developer.Dev_Name}`);
                selectedFiles = selectedFiles.filter((file) => file.Dev_Name !== developer.Dev_Name);
                console.log(`[INFO] Updated selected files:`, selectedFiles);
            }

            updateFileStats(); // Update stats
        });

        devElement.appendChild(leftDiv);
        devElement.appendChild(statsDiv);

        devElement.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox') return;
            handleDeveloperSelection(developer.Dev_Name);
        });

        fragment.appendChild(devElement);
    });

    // Add "ALL" developer entry
    const allDevElement = document.createElement('div');
    allDevElement.classList.add('developer-item');
    allDevElement.dataset.devName = 'ALL';

    const allLeftDiv = document.createElement('div');
    allLeftDiv.style.display = 'flex';
    allLeftDiv.style.alignItems = 'center';

    const allNameDiv = document.createElement('div');
    allNameDiv.textContent = 'ALL';
    allNameDiv.style.marginLeft = '10px';

    allLeftDiv.appendChild(allNameDiv);

    const allStatsDiv = document.createElement('div');
    allStatsDiv.style.display = 'flex';
    allStatsDiv.style.marginLeft = 'auto';
    allStatsDiv.style.gap = '20px';

    const allTotalFilesDiv = document.createElement('div');
    allTotalFilesDiv.textContent = totalFiles;

    const allDownloadedCountDiv = document.createElement('div');
    allDownloadedCountDiv.className = 'downloaded-column';
    allDownloadedCountDiv.textContent = totalDownloadedFiles;

    allStatsDiv.appendChild(allTotalFilesDiv);
    allStatsDiv.appendChild(allDownloadedCountDiv);

    allDevElement.appendChild(allLeftDiv);
    allDevElement.appendChild(allStatsDiv);

    // Add the click listener to the "ALL" developer element
    allDevElement.addEventListener('click', () => {
        console.log('[INFO] "ALL" developer clicked.');
        handleDeveloperSelection('ALL'); // Call the function to load all files
    });

    fragment.prepend(allDevElement);


    developerList.appendChild(fragment);

    console.log('[INFO] Developers loaded into the UI.');

    // Dynamically update columns when downloads complete
    window.api.on('file-status-updated', ({ fileName, status, developerName }) => {
        if (status === 'downloaded') {
            // Update developer's downloaded count
            const developerDiv = document.querySelector(`[data-dev-name="${developerName}"]`);
            if (developerDiv) {
                const downloadedColumn = developerDiv.querySelector('.downloaded-column');
                if (downloadedColumn) {
                    downloadedColumn.textContent = parseInt(downloadedColumn.textContent, 10) + 1;
                }
            }

            // Update "ALL" downloaded count
            const allDownloadedColumn = allDevElement.querySelector('.downloaded-column');
            if (allDownloadedColumn) {
                allDownloadedColumn.textContent = parseInt(allDownloadedColumn.textContent, 10) + 1;
            }
        }
    });
}


async function handleDeveloperSelection(devName) {
    console.log(`[INFO] Selected developer: ${devName}`);

    // Set the current developer
    currentDeveloper = devName;

    // Remove 'selected' class from all developer items
    const allDeveloperItems = document.querySelectorAll('.developer-item');
    allDeveloperItems.forEach((item) => item.classList.remove('selected'));

    // Add 'selected' class to the currently clicked developer
    const selectedDeveloper = document.querySelector(`[data-dev-name="${devName}"]`);
    if (selectedDeveloper) {
        selectedDeveloper.classList.add('selected');
    }

    try {
        let files = [];

        // Fetch files for "ALL" or a specific developer
        if (devName === 'ALL') {
            console.log('[INFO] Loading all files from the database.');
            if (!preloadedFiles.length) {
                preloadedFiles = await window.api.fetchAllFiles();
                console.log(`[DEBUG] Preloaded ${preloadedFiles.length} files from the database.`);

                // Fetch downloaded statuses for all files
                const fileNames = preloadedFiles.map((file) => file.File_Name);
                const fileStatuses = await window.api.checkMultipleFileStatuses(fileNames);
                preloadedFiles.forEach((file) => {
                    file.isDownloaded = fileStatuses[file.File_Name] || false;
                });
            }
            files = [...preloadedFiles];
        } else {
            console.log(`[INFO] Loading files for developer: ${devName}`);
            files = preloadedFiles.filter((file) => file.Dev_Name === devName);

            if (!files.length) {
                files = await window.api.fetchFilesByDeveloper(devName);
                console.log(`[DEBUG] Loaded ${files.length} files for developer: ${devName}`);

                // Fetch downloaded statuses for developer's files
                const fileNames = files.map((file) => file.File_Name);
                const fileStatuses = await window.api.checkMultipleFileStatuses(fileNames);
                files.forEach((file) => {
                    file.isDownloaded = fileStatuses[file.File_Name] || false;
                });

                // Add the developer's files to preloadedFiles
                preloadedFiles.push(...files);
            }
        }

        // Store the fetched files for current developer
        filteredFiles = files;

        // Apply filters
        applyFilters(); // Combine "Downloaded Only" and search filters
    } catch (err) {
        console.error(`[ERROR] Failed to load files for developer ${devName}:`, err);
        alert(`Failed to load files for developer: ${devName}`);
    }
}

// Apply filters for developers and files
// Apply filters for developers and files
function applyFilters() {
    // Filter the developer list
    filterDeveloperList();

    // Filter the file list
    if (!filteredFiles.length) return;

    let filesToDisplay = [...filteredFiles];

    // Apply "Downloaded Only" filter
    if (isViewingDownloaded) {
        filesToDisplay = filesToDisplay.filter((file) => file.isDownloaded);
        console.log(`[INFO] Filtering for "Downloaded Only": ${filesToDisplay.length} files.`);
    }

    // Apply search filter
    const searchQuery = searchFilesInput.value.trim().toLowerCase();
    if (searchQuery) {
        filesToDisplay = filesToDisplay.filter((file) =>
            file.File_Name.toLowerCase().includes(searchQuery)
        );
        console.log(`[INFO] Filtering for search query "${searchQuery}": ${filesToDisplay.length} files.`);
    }

    // Handle no matching files
    if (!filesToDisplay.length) {
        fileList.innerHTML = '<p>No files found matching the criteria.</p>';
        return;
    }

    // Load the filtered files into the UI
    loadFiles(filesToDisplay);
}

// Filter the developer list
function filterDeveloperList() {
    const developers = document.querySelectorAll('.developer-item');
    const searchQuery = searchDevelopersInput.value.trim().toLowerCase();

    developers.forEach((developer) => {
        const devName = developer.dataset.devName;
        const downloadedCount = parseInt(developer.querySelector('.downloaded-column').textContent, 10) || 0;

        const matchesSearch = !searchQuery || devName.toLowerCase().includes(searchQuery);
        const matchesDownloaded = !isViewingDownloaded || downloadedCount > 0;

        if (matchesSearch && matchesDownloaded) {
            developer.style.display = ''; // Show developer
        } else {
            developer.style.display = 'none'; // Hide developer
        }
    });

    console.log('[INFO] Developer list filtered.');
}

// Toggle "Downloaded Only" filter
toggleViewModeButton.addEventListener('click', () => {
    isViewingDownloaded = !isViewingDownloaded; // Toggle the state
    toggleViewModeButton.textContent = isViewingDownloaded ? 'View All' : 'View Downloaded';

    console.log(`[INFO] Toggled view mode: ${isViewingDownloaded ? 'Downloaded Only' : 'All Files'}`);
    applyFilters(); // Reapply filters
});

// Search bar input listener
if (!searchFilesInput.dataset.listenerAdded) {
    searchFilesInput.addEventListener('input', () => {
        console.log('[DEBUG] Search input event triggered.');
        applyFilters(); // Reapply filters on search
    });
    searchFilesInput.dataset.listenerAdded = true;
}

//Populates the file list for the selected developer.
//@param {Array} files - List of files for the selected developer.
async function loadFiles(files) {
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = ''; // Clear existing files

    const BATCH_SIZE = 50; // Number of files to load per batch
    let loadedCount = 0;

    const visibleFiles = new Map(); // Map to track currently visible file elements

    // Cache downloaded statuses for all files
    let fileStatuses = {};
    try {
        const fileNames = files.map((file) => file.File_Name);
        fileStatuses = await window.api.checkMultipleFileStatuses(fileNames); // Use batch query
        console.log('[DEBUG] Batch file statuses fetched:', fileStatuses);
    } catch (error) {
        console.error('[ERROR] Failed to fetch file statuses in bulk:', error.message);
    }

    // Apply filters: "Downloaded Only" and search query
    let filteredFiles = [...files];
    if (isViewingDownloaded) {
        filteredFiles = filteredFiles.filter((file) => fileStatuses[file.File_Name]);
        console.log(`[INFO] Filtered for "Downloaded Only": ${filteredFiles.length} files.`);
    }

    const searchQuery = searchFilesInput.value.trim().toLowerCase();
    if (searchQuery) {
        filteredFiles = filteredFiles.filter((file) =>
            file.File_Name.toLowerCase().includes(searchQuery)
        );
        console.log(`[INFO] Filtered for search query "${searchQuery}": ${filteredFiles.length} files.`);
    }

    // Handle no matching files
    if (!filteredFiles.length) {
        fileList.innerHTML = '<p>No files found matching the criteria.</p>';
        return;
    }

    console.log(`[DEBUG] Total files to display: ${filteredFiles.length}`);

    // Function to create a file element
    const createFileElement = (file) => {
        const fileElement = document.createElement('div');
        fileElement.classList.add('file-item');
        fileElement.dataset.fileName = file.File_Name.trim(); // Add fileName as a data attribute

        const isDownloaded = fileStatuses[file.File_Name] || false;

        fileElement.innerHTML = `
            <img src="${file.Thumbnail_URL || 'default-thumbnail.png'}" alt="${file.File_Name}" />
            <div>
                <b>${file.File_Name}</b>
                <p class="file-developer">by ${file.Dev_Name}</p>
                <p>
                    ${(file.File_Size / 1024 / 1024).toFixed(2)} MB
                    <span class="file-status-badge" style="margin-left: 10px;">${isDownloaded ? '✔ Downloaded' : '✖ Not Downloaded'}</span>
                </p>
                <p>${file.Release_Date}</p>
                <p>${file.Description.substring(0, 100)}...</p>
                <div class="button-container">
                    <button class="view-btn">View File</button>
                    <button class="delete-btn">Delete</button>
                    <button class="select-btn">Select</button>
                    <button class="download-btn">Download</button>
                </div>
            </div>
        `;

        // Style the status badge
        const fileStatusBadge = fileElement.querySelector('.file-status-badge');
        fileStatusBadge.style.color = 'white';
        fileStatusBadge.style.backgroundColor = isDownloaded ? 'green' : 'grey';

        // Add file actions
        addFileActions(fileElement, file);

        fileElement.addEventListener('dblclick', () => {
            openPopup(file); // Open popup for file details
        });

        return fileElement;
    };

    // Function to load a batch of files
    const loadBatch = (batch) => {
        const fragment = document.createDocumentFragment();
        for (const file of batch) {
            if (visibleFiles.has(file.File_Name)) continue; // Skip if already visible

            const fileElement = createFileElement(file);
            visibleFiles.set(file.File_Name, fileElement);
            fragment.appendChild(fileElement);
        }

        fileList.appendChild(fragment);
    };

    // Initial load of the first batch
    loadBatch(filteredFiles.slice(0, BATCH_SIZE));
    loadedCount += BATCH_SIZE;

    // Scroll listener for dynamic loading
    const onScroll = () => {
        const { scrollTop, scrollHeight, clientHeight } = fileList;

        // Load more files when scrolling down
        if (scrollTop + clientHeight >= scrollHeight - 10 && loadedCount < filteredFiles.length) {
            const nextBatch = filteredFiles.slice(loadedCount, loadedCount + BATCH_SIZE);
            loadBatch(nextBatch);
            loadedCount += BATCH_SIZE;
            console.log(`[DEBUG] Loaded ${loadedCount}/${filteredFiles.length} files.`);
        }
    };

    // Detach any existing scroll listener to avoid duplication
    fileList.removeEventListener('scroll', fileList._scrollListener);

    // Attach the new scroll listener
    fileList._scrollListener = onScroll;
    fileList.addEventListener('scroll', fileList._scrollListener);

    console.log('[INFO] File list loaded.');
}


function addFileActions(fileElement, file) {
    const selectBtn = fileElement.querySelector('.select-btn');
    selectBtn.addEventListener('click', () => {
        const isSelected = selectedFiles.find((f) => f.File_Name === file.File_Name);

        if (isSelected) {
            // Remove from selection
            selectedFiles = selectedFiles.filter((f) => f.File_Name !== file.File_Name);
            totalSize -= file.File_Size;
            selectBtn.textContent = 'Select';
        } else {
            // Add to selection
            selectedFiles.push(file);
            totalSize += file.File_Size;
            selectBtn.textContent = 'Deselect';
        }

        updateFileStats(); // Update stats on the top bar
    });

    const viewBtn = fileElement.querySelector('.view-btn');
    viewBtn.addEventListener('click', async () => {
        try {
            const filePath = await window.api.fetchDownloadedFile(file.File_Name);

            if (!filePath) {
                alert('File not found in downloaded database.');
                console.log('[ERROR] File not found:', file.File_Name);
                return;
            }

            console.log('[INFO] Opening file path:', filePath);

            const response = await window.api.viewFile(filePath);
            if (!response.success) {
                alert(`Error: ${response.message}`);
            }
        } catch (error) {
            console.log('[ERROR] Failed to view file:', error.message);
            alert('Failed to view file. Please try again.');
        }
    });

    const deleteBtn = fileElement.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', async () => {
        const confirmation = confirm(`Are you sure you want to delete "${file.File_Name}"?`);
        if (!confirmation) return;

        try {
            const filePath = await window.api.fetchDownloadedFile(file.File_Name);

            if (!filePath) {
                alert('File not found in downloaded database.');
                console.log('[ERROR] File not found in downloaded.db for:', file.File_Name);
                return;
            }

            console.log('[INFO] Attempting to delete file:', filePath);

            const response = await window.api.deleteFile(filePath);
            if (response.success) {
                alert(`File "${file.File_Name}" deleted successfully.`);
                const fileStatusBadge = fileElement.querySelector('.file-status-badge');
                fileStatusBadge.textContent = '✖ Not Downloaded';
                fileStatusBadge.style.color = 'white';
                fileStatusBadge.style.backgroundColor = 'grey';
                updateDeveloperStats(file.Dev_Name);
            } else {
                alert(`Error: ${response.message}`);
            }
        } catch (error) {
            console.log('[ERROR] Failed to delete file:', error.message);
            alert('Failed to delete file. Please try again.');
        }
    });

    const downloadBtn = fileElement.querySelector('.download-btn');
    downloadBtn.addEventListener('click', () => {
        console.log(`[INFO] Download button clicked for file: ${file.File_Name}`);

        // Add the file to the selected array if not already present
        if (!selectedFiles.find((f) => f.File_Name === file.File_Name)) {
            selectedFiles.push(file);
            updateFileStats(); // Update stats on the top bar
        }

        // Simulate a click on the "Download Selected" button
        document.getElementById('download-selected').click();
    });
    }

async function updateDeveloperStats(devName) {
    try {
        console.log(`[DEBUG] Updating stats for developer: ${devName}`);
        
        const isAllView = devName === 'ALL';

        // Fetch total downloaded files for "ALL"
        const downloadedCount = isAllView
            ? await window.api.fetchDownloadedCount('ALL') // Special query for "ALL"
            : await window.api.getDownloadedFilesForDeveloper(devName);

        const developerRow = document.querySelector(`[data-dev-name="${devName}"]`);
        if (developerRow) {
            const downloadedColumn = developerRow.querySelector('.downloaded-column');
            if (downloadedColumn) {
                downloadedColumn.textContent = downloadedCount;
                console.log(`[INFO] Updated download count for developer ${devName}: ${downloadedCount}`);
            } else {
                console.log(`[ERROR] Downloaded column not found for developer: ${devName}`);
            }
        } else if (isAllView) {
            // Special handling for "ALL"
            const allRow = document.querySelector(`[data-dev-name="ALL"]`);
            if (allRow) {
                const downloadedColumn = allRow.querySelector('.downloaded-column');
                if (downloadedColumn) {
                    downloadedColumn.textContent = downloadedCount;
                    console.log(`[INFO] Updated download count for "ALL": ${downloadedCount}`);
                }
            }
        } else {
            console.log(`[ERROR] Developer row not found for developer: ${devName}`);
        }
    } catch (err) {
        console.log(`[ERROR] Failed to update stats for developer: ${devName}`, err);
    }
}

// Fetch downloaded files and store them in a Set
async function loadDownloadedFiles() {
    try {
        const downloadedFiles = await window.api.invoke('fetch-downloaded-files');
        downloadedFilesSet = new Set(downloadedFiles); // Store as a Set for quick lookups
        console.log('[DEBUG] Downloaded files loaded:', downloadedFilesSet.size);
    } catch (err) {
        console.error('[ERROR] Failed to fetch downloaded files:', err.message);
    }
}

// Check if a file is downloaded
function isFileDownloaded(fileName) {
    return downloadedFilesSet.has(fileName); // Quick lookup in the Set
}

//////// PopUp Handling

// Modernized Popup Logic
function openPopup(file) {
    const popupOverlay = document.getElementById('popup-overlay');
    const popupImage = document.getElementById('popup-image');
    const popupTitle = document.getElementById('popup-title');
    const popupDescription = document.getElementById('popup-description');

    if (!popupOverlay || !popupImage || !popupTitle || !popupDescription) {
        console.log('[ERROR] Popup elements not found.');
        return;
    }

    // Set Popup Content
    popupImage.src = file.Thumbnail_URL || '';
    popupTitle.textContent = file.File_Name;
    popupDescription.textContent = file.Description;

     // Apply styles to constrain the image to a square
     popupImage.style.width = '700px'; // Fixed width for the square
     popupImage.style.height = '700px'; // Fixed height for the square
     popupImage.style.objectFit = 'contain'; // Ensure the entire image fits within the square
     popupImage.style.objectPosition = 'center'; // Center the image within the square
     popupImage.style.backgroundColor = 'transparent'; // Optional: Add a background for padding areas
     popupImage.style.borderRadius = '8px'; // Optional: Add rounded corners for aesthetics
 

    // Display the Popup
    popupOverlay.style.display = 'flex';

    // Change the popup background color
    popupOverlay.style.backgroundColor = 'rgba(10, 10, 10, 0.4)'; // Semi-transpar


    // Close the Popup on Background Click or Close Button
    const closePopup = (e) => {
        if (e.target === popupOverlay || e.target.id === 'popup-close') {
            popupOverlay.style.display = 'none';
        }
    };

    popupOverlay.addEventListener('click', closePopup);
    document.getElementById('popup-close').addEventListener('click', closePopup);
}


///////// File Action Logic

function deleteFile(file) {
    console.log(`[INFO] Deleting file: ${file.File_Name}`);
}

/**
 * Downloads a file from a given URL and saves it to the specified path.
 * @param {string} url - URL of the file to download.
 * @param {string} savePath - Local path to save the file.
 */
async function downloadFile(url, savePath) {
    try {
        const response = await axios.get(url, { responseType: 'stream' });
        const writer = fs.createWriteStream(savePath);

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } catch (error) {
        console.log(`Failed to download file: ${error.message}`);
        throw error;
    }
}


async function updateDeveloperList() {
    const developerElements = document.querySelectorAll('.developer-item');

    for (const devElement of developerElements) {
        const developerName = devElement.dataset.devName; // Get developer name from dataset
        try {
            const downloadedCount = await window.api.invoke('getDownloadedFilesForDeveloper', developerName);
            const downloadedColumn = devElement.querySelector('.downloaded-column');
            downloadedColumn.textContent = downloadedCount;
        } catch (err) {
            console.log(`[ERROR] Failed to update downloaded count for developer: ${developerName}`, err);
        }
    }
}

window.api.getConfig().then((config) => {
    console.log('[INFO] Loaded Config:', config);

    // Check if the configuration is valid
    if (!config) {
        console.log('[ERROR] Failed to load config. Configuration object is null or undefined.');
        return;
    }

    // Pre-fill the library folder if cached
//    if (config.libraryFolder) {
//        console.log('[INFO] Using cached library folder:', config.libraryFolder);
//        alert(`Library folder restored: ${config.libraryFolder}`);
//    } else {
//        console.log('[INFO] No library folder cached.');
//    }

    // Automatically load the last database if cached
    if (config.lastDatabase) {
        console.log('[INFO] Using cached database:', config.lastDatabase);

        // Fetch developers from the last loaded database
        window.api.fetchDevelopers(config.lastDatabase)
            .then(loadDevelopers)
            .catch((err) => {
                console.log('[ERROR] Failed to fetch developers on startup:', err.message);
                alert('Failed to fetch developers from the cached database. Please load a new database.');
            });
    } else {
        console.log('[INFO] No database cached.');
    }
}).catch((err) => {
    console.log('[ERROR] Failed to retrieve config:', err.message);
    alert('An error occurred while loading the configuration. Please check the logs for details.');
});

window.api.onAlert((message) => {
    alert(message);
});

window.api.on('file-status-updated', (updateInfo) => {
    console.log('[DEBUG] Received file-status-updated event:', updateInfo);

    if (!updateInfo || typeof updateInfo !== 'object') {
        console.error('[ERROR] Invalid updateInfo received:', updateInfo);
        return;
    }

    const { fileName, status, developerName } = updateInfo;

    if (!fileName || !status) {
        console.error('[ERROR] Missing fileName or status in updateInfo:', updateInfo);
        return;
    }

    console.log(`[INFO] Updating file status: ${fileName} -> ${status}`);

    // Locate the file element in the UI and update the badge
    const fileElement = Array.from(document.querySelectorAll('.file-item')).find((el) =>
        el.dataset.fileName === fileName
    );

    if (fileElement) {
        const statusBadge = fileElement.querySelector('.file-status-badge');
        if (statusBadge) {
            if (status === 'downloaded') {
                statusBadge.textContent = '✔ Downloaded';
                statusBadge.style.color = 'white';
                statusBadge.style.backgroundColor = 'green';
            } else {
                statusBadge.textContent = '✖ Error';
                statusBadge.style.color = 'white';
                statusBadge.style.backgroundColor = 'red';
            }
        }
    } else {
        console.error('[ERROR] File element not found for:', fileName);
    }

    // Update the developer's downloaded count in the UI
    if (developerName) {
        const developerDiv = document.querySelector(`[data-dev-name="${developerName}"]`);
        if (developerDiv) {
            const downloadedColumn = developerDiv.querySelector('.downloaded-column');
            if (downloadedColumn && status === 'downloaded') {
                const currentCount = parseInt(downloadedColumn.textContent, 10) || 0;
                downloadedColumn.textContent = currentCount + 1;
            }
        } else {
            console.warn('[WARN] Developer div not found for:', developerName);
        }
    }

    // Update the "ALL" downloaded count
    const allDownloadedColumn = document.querySelector('.developer-item[data-dev-name="ALL"] .downloaded-column');
    if (allDownloadedColumn && status === 'downloaded') {
        const currentAllCount = parseInt(allDownloadedColumn.textContent, 10) || 0;
        allDownloadedColumn.textContent = currentAllCount + 1;
    }
});

window.api.on('update-developer-stats', async (developerName) => {
    console.log(`[DEBUG] Received update-developer-stats event for developer: ${developerName}`);
    await updateDeveloperStats(developerName); // Call the corrected function
});

window.api.on('database-loaded', (dbPath) => {
    console.log('[INFO] Database loaded in renderer:', dbPath);
});

window.api.onDatabaseLoaded(async (dbPath) => {
    console.log('[DEBUG] Received database-loaded event with path:', dbPath);

    try {
        const developers = await window.api.fetchDevelopers(dbPath);
        console.log('[DEBUG] Developers fetched:', developers);

        loadDevelopers(developers);
        console.log('[DEBUG] Developer list updated after database-loaded event.');
    } catch (err) {
        console.log('[ERROR] Failed to fetch developers after database-loaded event:', err.message);
    }
});
