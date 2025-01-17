### Dotantions
It was brought up that people would like to donate and with the help of an awesome donator I was able to set up a BTC wallet for donations. If this doesnt work for you and you want to support me Ive created a paetreon. whether its monthly or just a one off as a 'tip' I have as little as 3 dollars and up.

https://www.patreon.com/c/Summt_60

BTC Wallet: bc1q806lw0z7lnrv0zc7ztg4k9vdv72npv7ma3nd6r


### Introducing A New File Manager and Browser!!

Frustrated by the difficulty in searching our site for the content we all crave, I took matters into my own hands (with a little help from ChatGPT) and developed a custom file manager and browser. This tool leverages a database built from The Black Lotus Coalition's Spreadsheet of Developers.

Key Features

-File Browsing and Management: Easily browse and manage your files with filters to view only downloaded items.
-Download Options: Perform single or batch downloads with ease.
-Selective Downloads:
-Download all files (~1.8TB)(New! as of 1.1.13 onoy non downloaded files will be selected. Yay progress!!)
-Download all files excluding audio/video (~0.68TB)(New! as of 1.1.13 onoy non downloaded files will be selected. Yay progress!!)
-Developer-Specific Downloads: Click the checkmark next to a developer to add all their files to the download queue.
-Image Previews: Double-click a file listing to view a full-size image along with its complete description.
-Database Updates: Update your database and populate new files using Files>Update Database
-Scan folders for files and either move to library or keep files and add to database

### Upcoming Features!
-Offline mode
-Thumbnail Caching: Option to cache all thumbnails for offline viewing of downloaded files or the entire database.

------------------------------------------------------------------------------------------------------------------------

### Update Overview (v1.1.13)(Major Update!)

Hello everyone! First off, I want to say thank you for all the love and support. I’m thrilled to hear that, despite a few (or more) issues, you’re all enjoying the browser. I’ve poured about 24 hours into this update—coding isn’t exactly my strong suit—and I’m excited to bring you version 1.1.13. This is a major release that fixes key problems like the lack of a maximum concurrent download limit, which previously made your computer go full throttle trying to download everything all at once. Here’s the breakdown:

![Screenshot 2025-01-17 173017](https://github.com/user-attachments/assets/8244219c-7783-45b6-83a4-06ae47e7a437)

**Streamlined Database Updates**
Previously, the browser used two databases, one of which had to be regenerated every single time. Not anymore! I’ve unified them into a single database, removed the need for “Load Database” and “ODS to Database,” and introduced “Update Database.”
Out of the box, you’ll have the most up-to-date database available at release.
Once you select your library folder, this database is moved there (it also remains in the program folder, should you need it again).
Because it’s simply an “update,” it now runs much faster.

![Screenshot 2025-01-17 173052](https://github.com/user-attachments/assets/5e3b2d4b-b197-4cc4-90a8-d5ded72b08b6)

**New File Highlights and Badges**
When an update finishes, you’ll see a total count of any new or changed files meaning If a developer updates a file, it’s marked as NEW. Developers with a new file are highlighted in purple (I couldn’t think of a better color!), and all new files have a purple 'NEW!!' badge until you click on them. As is all files will be labeled NEW, so you might need a bit of time to browse through them all.

**New Settings and Reset Options**
In the Files settings menu, you’ll see a new option to set your maximum number of concurrent downloads (default is 5). Be cautious if you raise this beyond 10; at just 5, Windows Antimalware Executable alone can singlehandedly run up to 50% CPU usage.
If you need to reset the database or just your downloaded list, there are buttons for both in the Debug menu. After resetting the database, you can still use Update Database to restore it.

![Screenshot 2025-01-17 100654](https://github.com/user-attachments/assets/36999391-2a56-4ac4-9f43-1960da2ebde4)

**Folder Scanning (for Existing Files)**
A popular request was the ability to scan a folder for files you’ve already downloaded—so here it is! Clicking Scan Folder (in the Files menu) prompts you to pick a folder. The scan will match files against its database for any file that has the same download name. (Note: if you renamed a file from its original download name, it won’t be recognized.)

Once scanning is done, you have two choices:

_Keep Files in Current Location_
**-**They’ll be marked as downloaded and have their paths added to the database.
**-**You can view them in the browser as downloaded, and clicking View will open their folder.

_Move Files to the Library Folder_
**-**They’ll be automatically organized into the correct folder structure (Library > dev > file name > file).
**-**They’ll be added to your downloaded list and the database for easy viewing in the browser.

I’m really pleased with how this turned out—I hope you will be, too!

![Screenshot 2025-01-17 173739](https://github.com/user-attachments/assets/b1920fdb-40d4-4ff4-bf25-b8208910b626)

**Minor Fixes**
**-**Downloaded files are no longer included in your “selected files” array. For instance, using Select All will exclude files you’ve already downloaded from the total size and count.
**-**Major code refactor thanks to the unified database system.
**-**Improved reliability of the search bar.
**-**Temp folder now cleans up properly after canceled downloads (instead of leaving leftover files).
**-**Increased the number of retries for the initial Lbrynet popup (from 10 tries over 10 seconds to 30 tries over 30 seconds), helping those stuck at 0 blocks.

**Future Plans**
**-**Scheduled updates with optional automatic downloads.
**-**Offline mode with cached thumbnails.

I hope you enjoy this update! I look forward to hearing any feedback or suggestions. Please report any bugs on GitHub so I don’t lose track of them!
Best wishes,
Summit_60

------------------------------------------------------------------------------------------------------------------------

Update 1.1.12

-GUI unification(popups are same style now)

-Revamp of search function for better reliability and includes description in search

-Search bar now states total results

-code organization and refactors(mainly GUI)

------------------------------------------------------------------------------------------------------------------------

Update 1.1.11!

thank you everyone for all of the support! here is a quick fix to the conversion system. I had inadvertently changed the extension of my list from black lotus so I believed it was a .xls file but now it will be able to go straight from odd sea to the app. also added a version check to ensure you have the latest and greatest!

Change log
-XLS to Database is now ODS to Database
this was a mistake on my part this should make a much simpler workflow of converting new spreadsheets
cleans up duplicate files
ensures devs with same name have separate listings

-Version check
added an automatic version check once sync is complete with prompt to download
added check for update option in the file menu






Todo list:
- Offline Mode
- Cache thumbnails
- Automatic update with optional automatic downloads
- Lite version running on a browser could replace the installed version ensuring cross platform compatability. user would have to download the correct lbrynet.exe or we include all three add OS detection...or something idk


  

Complete
-Limit concurrent downloads by user settings(default 100) integrate file check to be complete. download failure modal "should" update as is with failed downloads but will need to look into it
-Search folder for existing files. could be done as long as the existing file name matches the one listed in the database. these files and their path would be downloaded.db optionally they could be moved from their existing location into the folder structure maintained by the program. 
#1 priority is limiting concurrent downloads as it full sends it currently bogging down your computer
-Database Comparison with identifiers I'd a file is new or dev has new files
-code refactor/organization (highly needed) lots of dead or redundant code
-Gui style unification. many popups use differing styles of popups
-Add results to search (in progress)
