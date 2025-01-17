//////////////Imports and Initialization//////////////



const divider = document.getElementById('divider');
const developerSection = document.getElementById('developer-section');
const fileSection = document.getElementById('file-section');
const developerList = document.getElementById('developer-list');
const fileList = document.getElementById('file-list');
const fileCount = document.getElementById('file-count');
const fileSize = document.getElementById('file-size');
const searchDevelopersInput = document.getElementById('search-developers');
if (!searchDevelopersInput) {

}
const searchFilesInput = document.getElementById('search-files');

const toggleViewModeButton = document.getElementById('toggle-view-mode');
let isViewingDownloaded = false; // Tracks if the "View Downloaded" filter is active

//////////////Global State Variables//////////////

let selectedDeveloperId = 'all'; // Default to 'all' to show all files initially
let selectedFiles = [];
let downloadedFilesSet = new Set();
let totalSize = 0;
let isDragging = false;
let cancelDownloads = false; // Track cancel state
let currentDeveloper = null; // Tracks the selected developer
let preloadedFiles = [];

//////////////Search//////////////
let allFiles = []; // Full dataset
let files = [];    // Current filtered dataset

async function initializeFiles() {
    try {
        window.api.logToFile('[INFO] Initializing files...');
        
        // Fetch files from the database
        const rawFiles = await window.api.fetchAllFiles();
        if (!rawFiles || rawFiles.length === 0) {
            console.warn('[WARNING] No files found in the database.');
            allFiles = [];
            files = [];
            refreshFileList();
            return;
        }

        // Map files and their statuses
        const fileNames = rawFiles.map(file => file.File_Name);
        const fileStatuses = await window.api.checkMultipleFileStatuses(fileNames);

        allFiles = rawFiles.map(file => ({
            ...file,
            isDownloaded: !!fileStatuses[file.File_Name], // Assign the downloaded status
        }));

        files = [...allFiles];
        refreshFileList();
    } catch (error) {
        console.error('[ERROR] Failed to initialize files:', error.message);
    }
}

async function initializeDevelopers() {
    try {
        window.api.logToFile('[INFO] Initializing developers...');
        const developers = await window.api.fetchDevelopers();

        if (!developers || developers.length === 0) {
            console.warn('[WARNING] No developers found in the database.');
            loadDevelopers([]); // Call with an empty array to clear the UI
            return;
        }

        loadDevelopers(developers);
    } catch (error) {
        console.error('[ERROR] Failed to initialize developers:', error.message);
    }
}


// Add a debounced listener for search input
if (!searchFilesInput.dataset.listenerAdded) {
    const debouncedRefreshFileList = debounce(() => {
        window.api.logToFile('[DEBUG] Search input event triggered.');
        refreshFileList();
    }, 300); // Adjust debounce delay as needed

    searchFilesInput.addEventListener('input', debouncedRefreshFileList);
    searchFilesInput.dataset.listenerAdded = true; // Mark the listener as added
}

if (!searchDevelopersInput.dataset.listenerAdded) {
    const debouncedDeveloperSearch = debounce(refreshDeveloperList, 300);
    searchDevelopersInput.addEventListener('input', debouncedDeveloperSearch);
    searchDevelopersInput.dataset.listenerAdded = true; // Mark listener as added
    window.api.logToFile('[DEBUG] Developer search listener added.');
}

if (selectedDeveloperId && selectedDeveloperId !== 'all') {
    filteredFiles = filteredFiles.filter((file) => file.Dev_Id.trim().toLowerCase() === selectedDeveloperId.trim().toLowerCase());
    window.api.logToFile(`[DEBUG] Filtered by developer "${selectedDeveloperId}": ${filteredFiles.length} files.`);
}

async function refreshFileList() {
    try {
        window.api.logToFile('[DEBUG] Refreshing file list...');

        // Start with the full dataset
        let filteredFiles = [...files];
        window.api.logToFile(`[DEBUG] Initial file count: ${filteredFiles.length}`);

        // Apply the "Downloaded Only" filter if enabled
        if (isViewingDownloaded) {
            filteredFiles = filteredFiles.filter(file => file.isDownloaded);
            window.api.logToFile(`[DEBUG] Filtered by "Downloaded Only": ${filteredFiles.length} files.`);
        }

        // Apply the search query filter
        const searchQuery = searchFilesInput.value.trim().toLowerCase();
        if (searchQuery) {
            filteredFiles = filteredFiles.filter(file =>
                file.File_Name.toLowerCase().includes(searchQuery) ||
                (file.Description && file.Description.toLowerCase().includes(searchQuery))
            );
            window.api.logToFile(`[DEBUG] Filtered by search query "${searchQuery}": ${filteredFiles.length} files.`);
        }

        // Deduplicate files by File_Claim_ID
        filteredFiles = Array.from(new Map(filteredFiles.map(file => [file.File_Claim_ID, file])).values());
        window.api.logToFile(`[DEBUG] Unique files after deduplication: ${filteredFiles.length}`);

        // Update the results counter
        updateResultsCounter(filteredFiles.length);

        // Handle the case of no matching files
        if (filteredFiles.length === 0) {
            fileList.innerHTML = '<p>No files found matching the criteria.</p>';
            window.api.logToFile('[INFO] No files found matching the criteria.');
            return;
        }

        // Load and display the filtered files
        window.api.logToFile(`[DEBUG] Final file count for display: ${filteredFiles.length}`);
        await loadFiles(filteredFiles);
    } catch (error) {
        console.error('[ERROR] Failed to refresh file list:', error.message);
    }
}

function refreshDeveloperList() {
    const developerItems = document.querySelectorAll('.developer-item');
    const searchQuery = searchDevelopersInput?.value?.trim().toLowerCase() || ''; // Ensure valid query

    developerItems.forEach((devItem) => {
        const devName = devItem.dataset.devName;

        // Calculate downloaded count dynamically
        const downloadedCount = allFiles.filter(file => 
            file.Dev_Name === devName && file.isDownloaded
        ).length;

        // Check if the developer matches the toggle and search criteria
        const matchesToggle = !isViewingDownloaded || downloadedCount > 0;
        const matchesSearch = devName.toLowerCase().includes(searchQuery);

        devItem.style.display = matchesToggle && matchesSearch ? '' : 'none';
    });

    window.api.logToFile('[INFO] Developer list refreshed based on toggle and search.');
}

async function handleDeveloperSelection(developerName) {
    selectedDeveloperId = developerName === 'ALL' ? 'all' : developerName;
    window.api.logToFile(`[INFO] Developer selected: ${developerName}`);

    // Highlight the selected developer in the list
    const developerItems = document.querySelectorAll('.developer-item');
    developerItems.forEach((item) => {
        item.classList.toggle('selected', item.dataset.devName === developerName);
    });

    // Filter files based on the selected developer
    try {
        if (selectedDeveloperId === 'all') {
            files = [...allFiles]; // Reset to all files
        } else {
            files = allFiles.filter((file) => 
                file.Dev_Name.trim().toLowerCase() === selectedDeveloperId.trim().toLowerCase()
            );
        }

        refreshFileList(); // Refresh the file list after filtering
    } catch (error) {
        console.error(`[ERROR] Failed to filter files for developer: ${developerName}`, error);
    }
}

function updateResultsCounter(count) {
    const resultsCounter = document.getElementById('total-results-counter');
    if (resultsCounter) {
        resultsCounter.textContent = `Results: ${count}`;
        window.api.logToFile(`[DEBUG] Results counter updated: ${count}`);
    } else {
        console.error('[ERROR] Results counter element not found in the DOM.');
    }
}

// Debounce utility to limit frequent function calls
function debounce(func, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), delay);
    };
}

// Generic function to filter items based on query
function filterItems(items, query, fields) {
    const lowerCaseQuery = query.trim().toLowerCase();
    if (!lowerCaseQuery) return items;

    return items.filter((item) => {
        return fields.some((field) => item[field]?.toLowerCase().includes(lowerCaseQuery));
    });
}

function renderDeveloperList(developers) {
    developerList.innerHTML = ''; // Clear the current list
    developers.forEach((developer) => {
        const devElement = createDeveloperElement(developer); // Use your existing developer element creation logic
        devElement.dataset.devName = developer.Dev_Name; // Use Dev_Name instead of Dev_Id
        developerList.appendChild(devElement);
    });
}

// Debounced functions for search
const debouncedRefreshDeveloperList = debounce(refreshDeveloperList, 300);
const debouncedRefreshFileList = debounce(refreshFileList, 300);

//////////////Event Handlers//////////////

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

//////////////Utility Functions//////////////

    function showAlert(message, title = 'Alert') {
        const alertModal = document.getElementById('alert-modal');
        const alertTitle = document.getElementById('alert-modal-title');
        const alertMessage = document.getElementById('alert-modal-message');
        const closeBtn = document.getElementById('alert-modal-close-btn');

        // Set modal content
        alertTitle.textContent = title;
        alertMessage.textContent = message;

        // Show the modal
        alertModal.classList.remove('hidden');

        // Add event listener to close button
        closeBtn.addEventListener(
            'click',
            () => {
                alertModal.classList.add('hidden'); // Hide the modal
            },
            { once: true }
        );
}

window.api.on('reload-data', async () => {
    window.api.logToFile('[INFO] Reloading data due to database update...');
    await initializeFiles();
    await initializeDevelopers();
    window.api.logToFile('[INFO] Data reload completed.');
});

//////////////UI Management//////////////

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

    window.api.logToFile(`[INFO] Updated file stats: ${selectedFiles.length} files, ${totalSize} bytes.`);
}

async function loadDevelopers(developers) {
    window.api.logToFile('[DEBUG] Developers passed to loadDevelopers:', developers);

    if (!developers || developers.length === 0) {
        console.warn('[WARN] No developers found. Clearing developer list.');
        document.getElementById('developer-list').innerHTML = '<p>No developers available.</p>';
        return;
    }

    const developerList = document.getElementById('developer-list');
    developerList.innerHTML = ''; // Clear existing entries

    const developerNames = developers.map((dev) => dev.Dev_Name);
    let totalFiles = developers.reduce((sum, dev) => sum + (dev.totalFiles || 0), 0);

    // Fetch all downloaded and new counts in one API call
    let developerCounts = {};
    try {
        developerCounts = await window.api.getAllDeveloperCounts(); // Fetch downloaded and new counts
    } catch (err) {
        console.error(`[ERROR] Failed to fetch developer counts: ${err.message}`);
    }

    let totalDownloadedFiles = 0;
    const fragment = document.createDocumentFragment();

    developers.forEach((developer) => {
        const downloadedCount = developerCounts[developer.Dev_Name]?.downloaded || 0;
        const newCount = developerCounts[developer.Dev_Name]?.new || 0;
        totalDownloadedFiles += downloadedCount;

        const devElement = document.createElement('div');
        devElement.classList.add('developer-item');
        devElement.dataset.devName = developer.Dev_Name;

        // Highlight developers with new files
        if (newCount > 0) {
            devElement.classList.add('new-developer'); // Add a CSS class for styling new developers
        }

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
                window.api.logToFile(`[INFO] Selected developer: ${developer.Dev_Name}`);
                const files = await window.api.fetchFilesByDeveloper(developer.Dev_Name);
        
                // Filter for files where Downloaded = 0
                const nonDownloadedFiles = files.filter(file => file.Downloaded === 0);
        
                selectedFiles.push(...nonDownloadedFiles);
        
                // Remove duplicates
                selectedFiles = [...new Map(selectedFiles.map(file => [file.File_Claim_ID, file])).values()];
                window.api.logToFile('[INFO] Updated selected files:', selectedFiles);
            } else {
                window.api.logToFile(`[INFO] Deselected developer: ${developer.Dev_Name}`);
                selectedFiles = selectedFiles.filter(file => file.Dev_Name !== developer.Dev_Name);
                window.api.logToFile('[INFO] Updated selected files:', selectedFiles);
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
        window.api.logToFile('[INFO] "ALL" developer clicked.');
        handleDeveloperSelection('ALL'); // Call the function to load all files
    });

    fragment.prepend(allDevElement);

    developerList.appendChild(fragment);

    window.api.logToFile('[INFO] Developers loaded into the UI.');

    // Dynamically update columns when downloads or new status changes
    window.api.on('file-status-updated', ({ fileName, status, developerName }) => {
        if (developerName) {
            const developerDiv = document.querySelector(`[data-dev-name="${developerName}"]`);
            if (developerDiv) {
                // Update downloaded count
                const downloadedColumn = developerDiv.querySelector('.downloaded-column');
                if (downloadedColumn && status === 'downloaded') {
                    downloadedColumn.textContent = parseInt(downloadedColumn.textContent, 10) + 1;
                }

                // Remove highlight if no new files are left
                if (status === 'not-new') {
                    const newFilesCount = developerCounts[developerName]?.new || 0;
                    if (newFilesCount <= 0) {
                        developerDiv.classList.remove('new-developer');
                    }
                }
            }
        }
    });
}

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
        window.api.logToFile('[DEBUG] Batch file statuses fetched:', fileStatuses);
    } catch (error) {
        console.error('[ERROR] Failed to fetch file statuses in bulk:', error.message);
    }

    // Apply filters: "Downloaded Only" and search query
    let filteredFiles = [...files];
    if (isViewingDownloaded) {
        filteredFiles = filteredFiles.filter((file) => fileStatuses[file.File_Name]);
        window.api.logToFile(`[INFO] Filtered for "Downloaded Only": ${filteredFiles.length} files.`);
    }

    // Deduplicate filteredFiles based on File_Name
    filteredFiles = Array.from(new Map(filteredFiles.map(file => [file.File_Name, file])).values());
    window.api.logToFile(`[DEBUG] Deduplicated filtered files: ${filteredFiles.length}`);

    // Handle no matching files
    if (!filteredFiles.length) {
        const noFilesTemplate = document.getElementById('no-files-template').content.cloneNode(true);
        fileList.appendChild(noFilesTemplate);
        return;
    }

    window.api.logToFile(`[DEBUG] Total files to display: ${filteredFiles.length}`);

    // Function to create a file element from the template
    const createFileElement = (file) => {
        window.api.logToFile('[DEBUG] Creating file element for:', file);
    
        // Clone the template
        const template = document.getElementById('file-item-template').content.cloneNode(true);
    
        const fileElement = template.querySelector('.file-item');
        if (!fileElement) {
            console.error('[ERROR] Failed to find file-item in the template.');
            return null;
        }
    
        // Debugging: Check if buttons exist in the cloned template
        const selectBtn = fileElement.querySelector('.select-btn');
        const viewBtn = fileElement.querySelector('.view-btn');
        const deleteBtn = fileElement.querySelector('.delete-btn');
        const downloadBtn = fileElement.querySelector('.download-btn');
    
        viewBtn?.addEventListener('click', () => { window.api.logToFile(`View ${file.File_Name}`); });
        deleteBtn?.addEventListener('click', () => { window.api.logToFile(`Delete ${file.File_Name}`); });
        selectBtn?.addEventListener('click', () => { window.api.logToFile(`Select ${file.File_Name}`); });
        downloadBtn?.addEventListener('click', () => { window.api.logToFile(`Download ${file.File_Name}`); });
    
        if (!selectBtn || !viewBtn || !deleteBtn || !downloadBtn) {
            console.error('[ERROR] One or more buttons are missing in the file-item template.');
        }
    
        // Set file data
        fileElement.dataset.fileName = file.File_Name.trim();
        fileElement.dataset.devName = file.Dev_Name.trim();
    
        template.querySelector('.file-thumbnail').src = file.Thumbnail_URL || 'default-thumbnail.png';
        template.querySelector('.file-name').textContent = file.File_Name;
        template.querySelector('.file-developer').textContent = `by ${file.Dev_Name}`;
        template.querySelector('.file-size').textContent = `${(file.File_Size / 1024 / 1024).toFixed(2)} MB`;
    
        const statusBadge = template.querySelector('.file-status-badge');
    
        // Set badge based on the file's status
        if (file.New === 1) {
            statusBadge.textContent = 'NEW!!';
            statusBadge.style.color = 'white';
            statusBadge.style.backgroundColor = 'purple';
            fileElement.classList.add('new');
        } else if (fileStatuses[file.File_Name]) {
            statusBadge.textContent = '✔ Downloaded';
            statusBadge.style.color = 'white';
            statusBadge.style.backgroundColor = 'green';
            fileElement.classList.add('downloaded');
        } else {
            statusBadge.textContent = '✖ Not Downloaded';
            statusBadge.style.color = 'white';
            statusBadge.style.backgroundColor = 'grey';
        }
    
        template.querySelector('.file-release-date').textContent = file.Release_Date;
        template.querySelector('.file-description').textContent = `${file.Description.substring(0, 100)}...`;
    
        // Add double-click listener for popup
        fileElement.addEventListener('dblclick', async () => {
            window.api.logToFile(`[DEBUG] File double-clicked: ${file.File_Name}`);
            openPopup(file);
        });

        fileElement.addEventListener('click', async () => {
            window.api.logToFile(`[DEBUG] File clicked: ${file.File_Name}`);
        
            // If the file is new, mark it as not new
            if (file.New === 1) {
                try {
                    await window.api.markFileAsNotNew(file.File_Claim_ID);
                    file.New = 0;
        
                    // Update the status badge to "Not Downloaded"
                    statusBadge.textContent = '✖ Not Downloaded';
                    statusBadge.style.color = 'white';
                    statusBadge.style.backgroundColor = 'grey';
                    fileElement.classList.remove('new');
        
                    window.api.logToFile(`[INFO] File marked as not new: ${file.File_Claim_ID}`);
        
                    // Check if the developer still has any new files
                    const developerDiv = document.querySelector(`[data-dev-name="${file.Dev_Name}"]`);
                    if (developerDiv) {
                        const newFilesCount = await window.api.getNewFileCountForDeveloper(file.Dev_Name);
                        if (newFilesCount <= 0) {
                            window.api.logToFile(`[INFO] No new files for developer: ${file.Dev_Name}. Removing highlight.`);
                            developerDiv.classList.remove('new-developer');
                        }
                    }
                } catch (error) {
                    console.error('[ERROR] Failed to update file status:', error.message);
                }
            }
        });                
    
        // Attach actions to the file element
        addFileActions(fileElement, file);
        return fileElement;
    };

    // Function to load a batch of files
    const loadBatch = (batch) => {
        const fragment = document.createDocumentFragment();
        for (const file of batch) {
            if (visibleFiles.has(file.File_Name)) {
                window.api.logToFile(`[DEBUG] Skipping already visible file: ${file.File_Name}`);
                continue; // Skip if already visible
            }

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
            window.api.logToFile(`[DEBUG] Loaded ${loadedCount}/${filteredFiles.length} files.`);
        }
    };

    // Detach any existing scroll listener to avoid duplication
    fileList.removeEventListener('scroll', fileList._scrollListener);

    // Attach the new scroll listener
    fileList._scrollListener = onScroll;
    fileList.addEventListener('scroll', fileList._scrollListener);

    window.api.logToFile('[INFO] File list loaded.');
}

async function updateDeveloperStats(devName) {
    try {
        window.api.logToFile(`[DEBUG] Updating stats for developer: ${devName}`);

        let downloadedCount = 0;

        if (devName === 'ALL') {
            downloadedCount = await window.api.fetchDownloadedCount('ALL');
            window.api.logToFile(`[INFO] Total downloaded count for "ALL": ${downloadedCount}`);
        } else {
            downloadedCount = await window.api.getDownloadedFilesForDeveloper(devName);
            window.api.logToFile(`[INFO] Downloaded count for developer ${devName}: ${downloadedCount}`);
        }

        // Update the corresponding UI element
        const selector = devName === 'ALL' ? '[data-dev-name="ALL"]' : `[data-dev-name="${devName}"]`;
        const developerRow = document.querySelector(selector);

        if (developerRow) {
            const downloadedColumn = developerRow.querySelector('.downloaded-column');
            if (downloadedColumn) {
                downloadedColumn.textContent = downloadedCount;
                window.api.logToFile(`[INFO] Updated downloaded count for developer ${devName}: ${downloadedCount}`);
            } else {
                console.error('[ERROR] Downloaded column not found for developer:', devName);
            }
        } else {
            console.warn(`[WARN] Developer row not found for developer: ${devName}`);
        }
    } catch (err) {
        console.error(`[ERROR] Failed to update stats for developer: ${devName}`, err);
    }
}

function openPopup(file) {
    window.api.logToFile('[DEBUG] openPopup called with:', file);

    const popupOverlay = document.getElementById('popup-overlay');
    const popupImage = document.getElementById('popup-image');
    const popupTitle = document.getElementById('popup-title');
    const popupDescription = document.getElementById('popup-description');
    const closeButton = document.getElementById('popup-close');

    if (!popupOverlay || !popupImage || !popupTitle || !popupDescription || !closeButton) {
        console.error('[ERROR] One or more popup elements are missing.');
        return;
    }

    // Populate content
    popupImage.src = file.Thumbnail_URL || 'default-thumbnail.png';
    popupTitle.textContent = file.File_Name;
    popupDescription.textContent = file.Description;

    window.api.logToFile('[DEBUG] Popup content set.');

    // Show the popup
    popupOverlay.classList.remove('hidden');
    window.api.logToFile('[DEBUG] Popup displayed.');

    // Close popup logic
    const closePopup = (e) => {
        if (e.target === popupOverlay || e.target === closeButton) {
            popupOverlay.classList.add('hidden');
            window.api.logToFile('[DEBUG] Popup closed.');
        }
    };

    // Attach close event listeners
    popupOverlay.addEventListener('click', closePopup, { once: true });
    closeButton.addEventListener('click', closePopup, { once: true });
}

toggleViewModeButton.addEventListener('click', () => {
    isViewingDownloaded = !isViewingDownloaded; // Toggle the state
    toggleViewModeButton.textContent = isViewingDownloaded ? 'View All' : 'View Downloaded';

    window.api.logToFile(`[INFO] Toggled view mode: ${isViewingDownloaded ? 'Downloaded Only' : 'All Files'}`);
    refreshFileList();; // Reapply filters
});

//////////////Download and Progress File Management//////////////

function deleteFile(file) {
    window.api.logToFile(`[INFO] Deleting file: ${file.File_Name}`);
}

const initializeDownload = () => {
    document.getElementById('download-selected').addEventListener('click', async () => {
        const maxConcurrentDownloads = 2;
        const progressBar = document.getElementById('progress-bar');
        const progressStatus = document.getElementById('progress-status');
        const cancelButton = document.getElementById('cancel-downloads');
        const totalFiles = selectedFiles.length;

        if (totalFiles === 0) {
            showAlert('No files selected for download.');
            window.api.logToFile('[DEBUG] No files selected.');
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
            window.api.logToFile(`[DEBUG] Progress updated: ${processedFilesCount}/${totalFiles} (${percentage}%)`);
        };

        const cleanupIncompleteDownloads = () => {
            downloadQueue.forEach(file => {
                const developerFolder = path.join(global.libraryFolder, file.Dev_Name || 'UnknownDeveloper');
                const fileFolder = path.join(developerFolder, file.File_Name || 'UnknownFile');
                if (fs.existsSync(fileFolder) && fs.readdirSync(fileFolder).length === 0) {
                    fs.rmdirSync(fileFolder);
                    window.api.logToFile('[INFO] Cleaned up incomplete file folder:', fileFolder);
                }
                if (fs.existsSync(developerFolder) && fs.readdirSync(developerFolder).length === 0) {
                    fs.rmdirSync(developerFolder);
                    window.api.logToFile('[INFO] Cleaned up empty developer folder:', developerFolder);
                }
            });
        };

        const cancelDownloadsImmediately = async () => {
            cancelDownloads = true;
            window.api.logToFile('[INFO] Cancelling downloads...');
        
            // Kill active processes (if applicable)
            await window.api.killActiveProcesses(); // Custom function to kill all active processes
        
            // Clean up active downloads and queue
            activeDownloads = [];
            downloadQueue = [];
        
            // Cleanup incomplete downloads
            cleanupIncompleteDownloads();
        
            // Request main process to clean temp folders (_MEIxxxxx)
            await window.api.cleanTempFolders();
        };
        

        const removeExistingDialog = (dialogId) => {
            const existingDialog = document.getElementById(dialogId);
            if (existingDialog) {
                window.api.logToFile('[DEBUG] Removing existing dialog:', dialogId);
                document.body.removeChild(existingDialog);
            }
        };        
        
        function showFinalDialog() {
            const successModal = document.getElementById('success-modal');
            const failureModal = document.getElementById('failure-modal');
            const failedFilesList = document.getElementById('failed-files-list');
        
            if (failedFiles.length === 0) {
                // Show success modal
                successModal.classList.remove('hidden');
        
                // Add event listener to close button
                document.getElementById('close-success-modal').addEventListener(
                    'click',
                    () => {
                        successModal.classList.add('hidden');
                        window.api.logToFile('[DEBUG] Success modal closed.');
                    },
                    { once: true }
                );
            } else {
                // Populate failed files list
                failedFilesList.innerHTML = failedFiles
                    .map((file) => `<li>${file.File_Name}</li>`)
                    .join('');
        
                // Show failure modal
                failureModal.classList.remove('hidden');
        
                // Add event listener to close button
                document.getElementById('close-failure-modal').addEventListener(
                    'click',
                    () => {
                        failureModal.classList.add('hidden');
                        window.api.logToFile('[DEBUG] Failure modal closed.');
                        failedFiles = []; // Reset failed files
                    },
                    { once: true }
                );
            }
        }
                

        const showCancelDialog = () => {
            const modal = document.getElementById('cancel-dialog');
            window.api.logToFile('[DEBUG] Modal:', modal);
        
            if (!modal) {
                console.error('[ERROR] Cancel dialog modal not found in the DOM.');
                return;
            }
        
            const closeBtn = modal.querySelector('.close-btn');
            window.api.logToFile('[DEBUG] Close Button:', closeBtn);
        
            if (!closeBtn) {
                console.error('[ERROR] Close button not found inside cancel dialog modal.');
                return;
            }
        
            // Show the modal
            modal.classList.remove('hidden');
        
            // Close button logic
            closeBtn.addEventListener(
                'click',
                () => {
                    modal.classList.add('hidden'); // Hide the modal
                    window.api.logToFile('[DEBUG] Cancel dialog closed.');
                },
                { once: true } // Ensure the event listener is executed only once
            );
        };    

        const finalizeDownloads = () => {
            const processedFilesCount = completedFiles.size + failedFiles.length;
        
            if (processedFilesCount === totalFiles) {
                window.api.logToFile(`[INFO] All files processed. ${failedFiles.length} failures.`);
        
                // Clear the selectedFiles array
                selectedFiles = [];
                window.api.logToFile('[DEBUG] Cleared selectedFiles array after processing. Current contents:', selectedFiles);
        
                // Reset the UI (if needed, e.g., buttons, progress, etc.)
                updateFileStats(); // Recalculate stats for the top bar
                showFinalDialog(); // Show the final dialog
                document.querySelectorAll('.select-btn').forEach((btn) => {
                    btn.textContent = 'Select';});
            }
        };
        

        window.api.onTriggerCounter(({ fileName, status }) => {
            window.api.logToFile(`[DEBUG] Trigger-counter received in renderer: fileName=${fileName}, status=${status}`);
            
            // Locate the file element in the UI
            const fileElement = Array.from(document.querySelectorAll('.file-item')).find(
                (el) => el.dataset.fileName === fileName
            );
        
            // Update the badge based on status
            if (fileElement) {
                const statusBadge = fileElement.querySelector('.file-status-badge');
                if (statusBadge) {
                    if (status === 'downloaded') {
                        // Update to "Downloaded"
                        statusBadge.textContent = '✔ Downloaded';
                        statusBadge.style.color = 'white';
                        statusBadge.style.backgroundColor = 'green';
                        fileElement.classList.add('downloaded');
                    } else if (status === 'failed') {
                        // Update to "Error"
                        statusBadge.textContent = '✖ Error';
                        statusBadge.style.color = 'white';
                        statusBadge.style.backgroundColor = 'red';
                        fileElement.classList.remove('downloaded');
                    }
                } else {
                    console.warn(`[WARN] Status badge not found for file: ${fileName}`);
                }
            } else {
                console.warn(`[WARN] File element not found in UI for: ${fileName}`);
            }
        
            // Track the file based on its status
            if (status === 'downloaded') {
                completedFiles.add(fileName);
        
                // Update the isDownloaded flag in the files array
                const file = files.find(f => f.File_Name === fileName);
                if (file) {
                    file.isDownloaded = true;
                    window.api.logToFile(`[INFO] Updated isDownloaded for: ${fileName}`);
                } else {
                    console.warn(`[WARN] File not found in memory for: ${fileName}`);
                }
            } else if (status === 'failed') {
                if (!failedFiles.some(f => f.File_Name === fileName)) {
                    const file = selectedFiles.find(f => f.File_Name === fileName);
                    if (file) {
                        failedFiles.push(file);
                        window.api.logToFile('[DEBUG] Failed file added to array:', failedFiles);
                    }
                }
            }
        
            // Recalculate and update progress
            updateProgress();
            finalizeDownloads();
        });                           

        let isProcessing = false; // Ensure only one processQueue runs at a time

        const processQueue = async () => {
            if (isProcessing) return; // Prevent overlapping executions
            isProcessing = true;
        
            try {
                while (activeDownloads.length < maxConcurrentDownloads && downloadQueue.length > 0) {
                    const file = downloadQueue.shift();
                    window.api.logToFile(`[DEBUG] Starting download for: ${file.File_Name}`);
        
                    // Declare the downloadPromise variable first
                    let downloadPromise;
        
                    downloadPromise = new Promise((resolve, reject) => {
                        // Listener function for Trigger-counter
                        const onTriggerCounter = ({ fileName, status }) => {
                            if (fileName === file.File_Name) {
                                window.api.logToFile(`[DEBUG] Trigger-counter received for: ${fileName}, status=${status}`);
                                window.api.removeListener('Trigger-counter', onTriggerCounter); // Clean up listener
                                resolve(status === 'downloaded'); // Resolve based on success/failure
                            }
                        };
        
                        // Add the event listener
                        window.api.on('Trigger-counter', onTriggerCounter);
        
                        // Start the actual download
                        window.api.downloadFile(file).catch(error => {
                            window.api.removeListener('Trigger-counter', onTriggerCounter); // Clean up on failure
                            reject(error); // Reject the promise on download error
                        });
                    });
        
                    // Add to active downloads
                    activeDownloads.push(downloadPromise);
        
                    // Handle download completion
                    downloadPromise.finally(() => {
                        activeDownloads.splice(activeDownloads.indexOf(downloadPromise), 1); // Remove from active downloads
                        window.api.logToFile(`[DEBUG] Download complete for: ${file.File_Name}`);
                        processQueue(); // Continue processing the queue
                    });
                }
            } finally {
                isProcessing = false; // Allow further queue processing
                await updateDeveloperStats(); // Update stats after download
            }
        };
                     
              
        const startDownload = async () => {
            // Fetch the current maxConcurrentDownloads from the main process
            const maxConcurrentDownloads = await window.api.invoke('get-max-downloads');
            window.api.logToFile(`[DEBUG] Starting downloads with maxConcurrentDownloads: ${maxConcurrentDownloads}`);
            window.api.logToFile('[INFO] Download started.');
        
            // Start queue processing
            processQueue();
        
            // Track when all downloads are complete
            await Promise.all(activeDownloads);
        
            // Once all downloads are complete, trigger finalizeDownloads
            finalizeDownloads();
            window.api.logToFile('[INFO] All downloads completed.');
        };
        
                         
        startDownload();

        if (cancelButton && !cancelButton.dataset.listenerAdded) {
            cancelButton.addEventListener('click', () => {
                cancelDownloads = true;
                //window.api.logToFile('[INFO] Downloads canceled.');
                cancelDownloadsImmediately();
                showCancelDialog();
            });
            cancelButton.dataset.listenerAdded = 'true';
        }
    });
};

async function loadDownloadedFiles() {
    try {
        window.api.logToFile('[INFO] Loading downloaded files from database...');

        // Query the database for files marked as downloaded
        const downloadedFiles = await window.api.invoke('query-database', 'fetchDownloadedFiles');

        // Create a Set for quick lookups
        downloadedFilesSet = new Set(downloadedFiles.map(file => file.File_Name));
        window.api.logToFile('[DEBUG] Downloaded files loaded:', downloadedFilesSet.size);

    } catch (err) {
        console.error('[ERROR] Failed to fetch downloaded files:', err.message);
    }
}


function isFileDownloaded(fileName) {
    return downloadedFilesSet.has(fileName); // Quick lookup in the Set
}

function addFileActions(fileElement, file) {
    window.api.logToFile('[DEBUG] Adding file actions for:', file.File_Name);

    // Buttons
    const selectBtn = fileElement.querySelector('.select-btn');
    const viewBtn = fileElement.querySelector('.view-btn');
    const deleteBtn = fileElement.querySelector('.delete-btn');
    const downloadBtn = fileElement.querySelector('.download-btn');

    // Debug Button Existence
    window.api.logToFile('[DEBUG] Buttons found for file:', file.File_Name, {
        selectBtn: !!selectBtn,
        viewBtn: !!viewBtn,
        deleteBtn: !!deleteBtn,
        downloadBtn: !!downloadBtn,
    });

    // Add Select Button Listener
    if (selectBtn) {
        selectBtn.addEventListener('click', () => {
            window.api.logToFile(`[DEBUG] Select clicked for: ${file.File_Name}`);
            const isSelected = selectedFiles.some((f) => f.File_Name === file.File_Name);
            if (isSelected) {
                selectedFiles = selectedFiles.filter((f) => f.File_Name !== file.File_Name);
                totalSize -= file.File_Size;
                selectBtn.textContent = 'Select';
            } else {
                selectedFiles.push(file);
                totalSize += file.File_Size;
                selectBtn.textContent = 'Deselect';
            }
            updateFileStats(); // Update UI stats
        });
    } else {
        console.error('[ERROR] Select button missing for:', file.File_Name);
    }

    // Add View Button Listener
    if (viewBtn) {
        viewBtn.addEventListener('click', async () => {
            window.api.logToFile(`[DEBUG] View clicked for: ${file.File_Name}`);
            try {
                // Fetch the file path from the database
                const filePath = await window.api.fetchDownloadedFile(file.Alt_File_Name);
    
                if (!filePath) {
                    showAlert('File not found in database.', 'Error');
                    console.warn('[WARN] File path not found for:', file.File_Name);
                    return;
                }
    
                // Send a request to open the folder
                window.api.logToFile('[INFO] Requesting to open folder containing file:', filePath);
                await window.api.openFolder(filePath);
            } catch (err) {
                console.error('[ERROR] Failed to open file folder:', err.message);
                showAlert('Failed to open file folder. Please try again.', 'Error');
            }
        });
    }
    
    // Add Delete Button Listener
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            window.api.logToFile(`[DEBUG] Delete clicked for: ${file.File_Name}`);
    
            try {
                let filePath = file.File_Path;
    
                // If `filePath` is missing, fetch it dynamically
                if (!filePath) {
                    console.warn('[WARN] File path is missing in file object. Fetching from database.');
                    filePath = await window.api.fetchDownloadedFile(file.Alt_File_Name);
                }
    
                if (!filePath) {
                    console.error('[ERROR] File path is null or undefined for deletion.');
                    showAlert('Cannot delete file: Path is missing.');
                    return;
                }
    
                const response = await window.api.invoke('delete-file', filePath);
                if (response.success) {
                    showAlert(`File "${file.File_Name}" deleted successfully.`);
    
                    // Update the badge
                    const statusBadge = fileElement.querySelector('.file-status-badge');
                if (statusBadge) {
                    statusBadge.textContent = '✖ Not Downloaded';
                    statusBadge.style.color = 'white';
                    statusBadge.style.backgroundColor = 'grey';
                    fileElement.classList.remove('downloaded');
                }
    
                    // Update developer stats
                    await updateDeveloperStats(file.Dev_Name); // Update stats for the specific developer
                    await updateDeveloperStats('ALL'); // Update stats for "ALL"
                } else {
                    showAlert(`Failed to delete file: ${response.message}`);
                }
            } catch (err) {
                console.error('[ERROR] Failed to delete file:', err.message);
                showAlert('An error occurred while deleting the file.');
            }
        });
    }    
    
    // Add Download Button Listener
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            window.api.logToFile(`[DEBUG] Download clicked for: ${file.File_Name}`);
            if (!selectedFiles.some((f) => f.File_Name === file.File_Name)) {
                selectedFiles.push(file);
                updateFileStats(); // Update UI stats
            }
            const downloadSelectedBtn = document.getElementById('download-selected');
            if (downloadSelectedBtn) {
                downloadSelectedBtn.click(); // Simulate clicking the "Download Selected" button
            } else {
                console.error('[ERROR] Download Selected button missing.');
            }
        });
    } else {
        console.error('[ERROR] Download button missing for:', file.File_Name);
    }
}

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

const getFolderPath = (file) => {
    const libraryFolder = window.api.getLibraryFolder(); // Ensure you expose this in preload
    if (!libraryFolder) {
        throw new Error('[ERROR] Library folder is not set.');
    }
    return window.api.path.join(libraryFolder, file.Dev_Name || 'UnknownDeveloper');
};

//////////////Imports and Constants//////////////








//lbrynet
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
            window.api.logToFile('[DEBUG] Modal closed.');
        }, 500); // Match the CSS transition duration
    }

    if (window.lbrynet && typeof window.lbrynet.onStatusUpdate === 'function') {
        window.lbrynet.onStatusUpdate((status) => {
            window.api.logToFile('[DEBUG] Received lbrynet-status update:', status);

            let blocksBehind = null;

            if (typeof status === 'object' && status.blocksBehind !== undefined) {
                blocksBehind = status.blocksBehind;
            } else if (typeof status === 'string') {
                if (status === 'Synchronization complete.') {
                    window.api.logToFile('[DEBUG] Synchronization complete. Closing modal.');
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
                window.api.logToFile(`[DEBUG] Updated blocks remaining: ${blocksBehind}`);

                if (blocksBehind === 0) {
                    window.api.logToFile('[DEBUG] blocksBehind is 0. Closing modal...');
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

//everything else
document.addEventListener('DOMContentLoaded', () => {
    window.api.logToFile('[INFO] renderer.js loaded and running');

    const settingsModal = document.getElementById('settings-modal');
    const maxDownloadsInput = document.getElementById('max-downloads');
    const saveSettingsButton = document.getElementById('save-settings');
    const closeSettingsButton = document.getElementById('close-settings');
    const developerSection = document.getElementById('developer-section');
    const divider = document.getElementById('divider');
    const selectAllBtn = document.getElementById('select-all');
    const selectNoAudioVideoBtn = document.getElementById('select-no-audio-video');
    const deselectAllBtn = document.getElementById('deselect-all');
    const cancelDownloadsButton = document.getElementById('cancel-downloads');
    const developerList = document.getElementById('developer-list');

    let isResizing = false;

    // Settings Modal Logic
    if (settingsModal && maxDownloadsInput && saveSettingsButton && closeSettingsButton) {
        window.api.on('open-settings', async () => {
            const currentMaxDownloads = await window.api.invoke('get-max-downloads');
            maxDownloadsInput.value = currentMaxDownloads; // Set the current value dynamically
            settingsModal.classList.remove('hidden');
        });

        saveSettingsButton.addEventListener('click', async () => {
            const newMaxDownloads = parseInt(maxDownloadsInput.value, 10);
            if (!isNaN(newMaxDownloads) && newMaxDownloads > 0) {
                await window.api.invoke('update-max-downloads', newMaxDownloads);
                alert(`Max concurrent downloads updated to: ${newMaxDownloads}`);
                settingsModal.classList.add('hidden');
            } else {
                alert('Please enter a valid number greater than 0.');
            }
        });

        closeSettingsButton.addEventListener('click', () => {
            settingsModal.classList.add('hidden');
        });
    }

    // Popup Modal Logic
    const closePopupButton = document.getElementById('close-popup');
    if (closePopupButton) {
        closePopupButton.addEventListener('click', () => {
            const popupModal = document.getElementById('popup-modal');
            if (popupModal) {
                popupModal.style.display = 'none';
                window.api.logToFile('[INFO] Popup closed.');
            } else {
                console.error('[ERROR] Popup modal element not found.');
            }
        });
    } else {
        console.error('[ERROR] Close button for popup not found.');
    }

    // Divider Resizing Logic
    if (divider) {
        divider.addEventListener('mousedown', () => {
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
    }

    // Cancel Downloads Button Logic
    if (cancelDownloadsButton) {
        cancelDownloadsButton.addEventListener('click', () => {
            cancelDownloads = true; // Set cancel state
            window.api.logToFile('[INFO] Canceled downloads.');
        });
    } else {
        console.error('[ERROR] Cancel Downloads button not found in the DOM.');
    }

    // File Selection Logic
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', async () => {
            try {
                const allFiles = await window.api.fetchAllFiles();
    
                // Filter for files where Downloaded = 0
                const nonDownloadedFiles = allFiles.filter(file => file.Downloaded === 0);
    
                selectedFiles = [...nonDownloadedFiles];
                totalSize = selectedFiles.reduce((sum, file) => sum + file.File_Size, 0);
    
                // Update all developer checkboxes programmatically
                const developerCheckboxes = document.querySelectorAll('.developer-item input[type="checkbox"]');
                developerCheckboxes.forEach((checkbox) => (checkbox.checked = true));
    
                updateFileStats();
                window.api.logToFile('[INFO] Selected non-downloaded files:', selectedFiles);
            } catch (error) {
                console.error('[ERROR] Failed to select all files:', error);
            }
        });
    }    
    
    if (selectNoAudioVideoBtn) {
        selectNoAudioVideoBtn.addEventListener('click', async () => {
            try {
                const allFiles = await window.api.fetchAllFiles();
    
                // Filter for files where Downloaded = 0 and media type is not audio/video
                const nonDownloadedNoAudioVideoFiles = allFiles.filter(file => {
                    const mediaType = file.Media_Type?.toLowerCase() || '';
                    return file.Downloaded === 0 && !mediaType.startsWith('video/') && !mediaType.startsWith('audio/');
                });
    
                selectedFiles = [...nonDownloadedNoAudioVideoFiles];
                totalSize = selectedFiles.reduce((sum, file) => sum + file.File_Size, 0);
    
                updateFileStats();
                window.api.logToFile('[INFO] Selected non-downloaded, non-audio/video files:', selectedFiles);
            } catch (error) {
                console.error('[ERROR] Failed to select no audio/video files:', error);
            }
        });
    }    

    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
            selectedFiles = [];
            totalSize = 0;

            // Uncheck all developer checkboxes programmatically
            const developerCheckboxes = document.querySelectorAll('.developer-item input[type="checkbox"]');
            developerCheckboxes.forEach((checkbox) => (checkbox.checked = false));

            updateFileStats();
            window.api.logToFile('[INFO] All files deselected.');
        });
    }

    // Developer Checkbox Logic
    if (developerList) {
        developerList.addEventListener('change', async (event) => {
            const checkbox = event.target;
            if (checkbox.classList.contains('developer-checkbox')) {
                const devName = checkbox.getAttribute('data-dev-name');

                if (checkbox.checked) {
                    try {
                        const files = await window.api.fetchFilesByDeveloper(devName);
                        selectedFiles.push(...files);
                        totalSize += files.reduce((sum, file) => sum + file.File_Size, 0);
                    } catch (error) {
                        console.error(`[ERROR] Failed to fetch files for developer ${devName}:`, error);
                    }
                } else {
                    selectedFiles = selectedFiles.filter((file) => file.Dev_Name !== devName);
                    totalSize = selectedFiles.reduce((sum, file) => sum + file.File_Size, 0);
                }

                updateFileStats();
            }
        });
    }
});

window.api.getConfig().then((config) => {
    window.api.logToFile('[INFO] Loaded Config:', config);

    // Check if the configuration is valid
    if (!config || !config.libraryFolder) {
        console.error('[ERROR] Library folder not set or configuration is invalid.');
        showAlert('Please set a library folder in the settings.');
        return;
    }

    window.api.logToFile('[INFO] Using library folder:', config.libraryFolder);

    // Fetch developers from the main database
    setTimeout(() => {
        window.api.fetchDevelopers()
        .then(() => { 
            initializeDevelopers();
            initializeFiles();
            
        })
        .catch((err) => {
            console.error('[ERROR] Failed to fetch developers on startup:', err.message);
            showAlert('Failed to fetch developers. Please check your library settings.');
        });
    }, 3000); // Wait for 2 seconds before calling the initialization functions

        
}).catch((err) => {
    console.error('[ERROR] Failed to retrieve configuration:', err.message);
    showAlert('An error occurred while loading the configuration. Please check the logs for details.');
});

window.api.on('file-status-updated', (updateInfo) => {
    window.api.logToFile('[DEBUG] Received file-status-updated event:', updateInfo);

    // Validate the updateInfo object
    if (!updateInfo || typeof updateInfo !== 'object') {
        console.error('[ERROR] Invalid updateInfo received:', updateInfo);
        return;
    }

    const { fileName, status, developerName, isNew } = updateInfo;

    if (!fileName || status === undefined) {
        console.error('[ERROR] Missing fileName or status in updateInfo:', updateInfo);
        return;
    }

    window.api.logToFile(`[INFO] Updating file status: ${fileName} -> ${status}, isNew: ${isNew}`);

    // Locate and update the file element in the UI
    const fileElement = Array.from(document.querySelectorAll('.file-item')).find((el) =>
        el.dataset.fileName === fileName
    );

    if (fileElement) {
        const statusBadge = fileElement.querySelector('.file-status-badge');
        if (statusBadge) {
            if (isNew === 1) {
                statusBadge.textContent = 'NEW!!';
                statusBadge.style.color = 'white';
                statusBadge.style.backgroundColor = 'purple';
                fileElement.classList.add('new');
            } else if (status === 'downloaded') {
                statusBadge.textContent = '✔ Downloaded';
                statusBadge.style.color = 'white';
                statusBadge.style.backgroundColor = 'green';
                fileElement.classList.remove('new');
                fileElement.classList.add('downloaded');
            } else {
                statusBadge.textContent = '✖ Not Downloaded';
                statusBadge.style.color = 'white';
                statusBadge.style.backgroundColor = 'grey';
                fileElement.classList.remove('new');
                fileElement.classList.remove('downloaded');
            }
        }
    } else {
        console.warn('[WARN] File element not found in UI for:', fileName);
    }

    // Highlight developers with new files
    if (developerName) {
        const developerDiv = document.querySelector(`[data-dev-name="${developerName}"]`);
        if (developerDiv) {
            const hasNewFiles = Array.from(document.querySelectorAll('.file-item')).some(
                (fileEl) => fileEl.dataset.devName === developerName && fileEl.classList.contains('new')
            );
            developerDiv.style.backgroundColor = hasNewFiles ? 'purple' : '';
        } else {
            console.warn('[WARN] Developer div not found for:', developerName);
        }
    }

    // Update the developer's downloaded count in the UI
    if (developerName) {
        const developerDiv = document.querySelector(`[data-dev-name="${developerName}"]`);
        if (developerDiv) {
            const downloadedColumn = developerDiv.querySelector('.downloaded-column');
            if (downloadedColumn) {
                const currentCount = parseInt(downloadedColumn.textContent, 10) || 0;
                if (status === 'downloaded') {
                    downloadedColumn.textContent = currentCount + 1;
                } else if (status === 'not-downloaded' && currentCount > 0) {
                    downloadedColumn.textContent = currentCount - 1;
                }
            }
        }
    }

    // Update the "ALL" downloaded count
    const allDownloadedColumn = document.querySelector('.developer-item[data-dev-name="ALL"] .downloaded-column');
    if (allDownloadedColumn) {
        const currentAllCount = parseInt(allDownloadedColumn.textContent, 10) || 0;
        if (status === 'downloaded') {
            allDownloadedColumn.textContent = currentAllCount + 1;
        } else if (status === 'not-downloaded' && currentAllCount > 0) {
            allDownloadedColumn.textContent = currentAllCount - 1;
        }
    }
});

window.api.on('update-developer-stats', async (developerName) => {
    window.api.logToFile(`[DEBUG] Received update-developer-stats event for developer: ${developerName}`);
    await updateDeveloperStats(developerName); // Call the corrected function
});

window.api.on('database-loaded', (dbPath) => {
    window.api.logToFile('[INFO] Database loaded in renderer:', dbPath);
});

window.api.onDatabaseLoaded(() => {
    window.api.logToFile('[INFO] Database loaded. Initializing developers and files.');
    initializeDevelopers(); // Ensure developers are loaded
    initializeFiles();      // Ensure files are loaded
});




















window.api.on('scan-folder', async () => {
    const folderPath = await window.api.selectFolder();
    if (!folderPath) return;

    try {
        const matchingFiles = await window.api.scanFolder(folderPath);
        if (matchingFiles.length === 0) {
            alert('No matching files found.');
            return;
        }

        const fileCount = matchingFiles.length;
        showScanResults(matchingFiles, folderPath, fileCount);
    } catch (error) {
        console.error('[ERROR] Failed to scan folder:', error);
        alert('An error occurred while scanning the folder.');
    }
});

function showScanResults(files, folderPath, fileCount) {
    const modal = document.getElementById('scan-results-modal');
    const resultsContainer = document.getElementById('scan-results-container');

    // Display file count
    resultsContainer.innerHTML = `
        <p><strong>${fileCount}</strong> matching files found in</p>
        <p>"${folderPath}".</p>
        <p>Choose an action for these files:</p>
    `;

    const moveBtn = document.getElementById('move-files-btn');
    const keepBtn = document.getElementById('keep-files-btn');

    moveBtn.onclick = async () => handleFiles(files, 'move');
    keepBtn.onclick = async () => handleFiles(files, 'keep');

    modal.classList.remove('hidden');
}

async function handleFiles(files, action) {
    try {
        const result = await window.api.processScannedFiles(files, action);
        if (result) {
            initializeDevelopers();
            initializeFiles();


            // Close the modal after processing
            const modal = document.getElementById('scan-results-modal');
            if (modal) {
                modal.classList.add('hidden'); // Hide the modal
            }

            alert('Files processed successfully.');
        }
    } catch (error) {
        console.error('[ERROR] Failed to process files:', error.message);
        alert('An error occurred while processing files. Please try again.');
    }
}
