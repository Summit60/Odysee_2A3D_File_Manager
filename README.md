### Introducing A New File Manager and Browser!!

![Screenshot 2025-01-13 004129](https://github.com/user-attachments/assets/a5a85930-1195-4a17-8f2f-91a8b8baeabb)

Frustrated by the difficulty in searching our site for the content we all crave, I took matters into my own hands (with a little help from ChatGPT) and developed a custom file manager and browser. This tool leverages a database built from The Black Lotus Coalition's Spreadsheet of Developers.

### About This Release

This is my first full-fledged application and program release. As such, you might encounter some bugs and quirks. For instance, the GUI behaved unexpectedly just before release, but I prioritized getting it out into the wild. Your feedback is invaluable—please report any bugs you find. A GitHub repository will be available for bug reporting and contributions, ensuring this project thrives with your support.

### Known Issues

-Dialog Boxes: Some dialog boxes may not look as I intended them to be....they used to be...but I digress
-File Downloads: Certain files may consistently fail to download. This occurs because the ODS to Database converter retrieves each developer's "channel" and queries every claim (file) assigned to them on LBRY. Sometimes developers delete files, but their claims remain active, leading to download failures.

Search and Scrolling: Occasionally, search or scrolling features may become unresponsive. Restarting the application typically resolves these issues.

![Screenshot 2025-01-13 000350](https://github.com/user-attachments/assets/f3d6b14f-1d5e-4c55-8356-e70c07cf15ed)
### 
Key Features

-File Browsing and Management: Easily browse and manage your files with filters to view only downloaded items.
-Download Options: Perform single or batch downloads with ease.
-Selective Downloads:
-Download all files (1.8TB)
-Download all files excluding audio/video (0.68TB)
-Developer-Specific Downloads: Click the checkmark next to a developer to add all their files to the download queue.
-Image Previews: Double-click a file listing to view a full-size image along with its complete description.
-Database Updates: Convert The Black Lotus Coalition spreadsheet into a database. I recommend updating this weekly to include new files, even if the -spreadsheet hasn't been updated, as it only lists developer names, not their files.

![Screenshot 2025-01-12 100853](https://github.com/user-attachments/assets/20c06df4-7971-4c7c-9f00-0410e7d96337)

### Upcoming Features!

-Database Comparison: Compare databases to view all new files between versions with a user-friendly popup.
-Thumbnail Caching: Option to cache all thumbnails for offline viewing of downloaded files or the entire database.

I’m sure there are additional features and optimizations you’ll discover as you navigate the application. Stay tuned for more updates and enhancements!

Get Involved

Thank you for your support, and happy browsing!



Todo list:

#1 priority is limiting concurrent downloads as it full sends it currently bogging down your computer

-Database Comparison with identifiers I'd a file is new or dev has new files

-code refactor/organization (highly needed) lots of dead or redundant code

-Search folder for existing files. could be done as long as the existing file name matches the one listed in the database. these files and their path would be downloaded.db optionally they could be moved from their existing location into the folder structure maintained by the program. 


- Lite version running on a browser could replace the installed version ensuring cross platform compatability. user would have to download the correct lbrynet.exe or we include all three add OS detection...or something idk

-Limit concurrent downloads by user settings(default 100) integrate file check to be complete. download failure modal "should" update as is with failed downloads but will need to look into it
  



Complete


-Gui style unification. many popups use differing styles of popups

-Add results to search (in progress)
