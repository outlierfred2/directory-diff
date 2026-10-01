# Directory Diff

Compare two directories and download a complete diff report.

1. Select **Input** and **Golden** directories.
2. Click **Compare directories**.
3. Select a file to view its changes, or choose **Download report**.

Files match by their paths inside each directory. Root names can differ: `input/backend/accounts/models.py` matches `golden_output/backend/accounts/models.py`.

Reports show the changes from **Input** to **Golden**. Added files exist only in Golden; removed files exist only in Input. Reports include modified, added, removed, unchanged, and unreadable files.

Text diffs show line numbers, additions, deletions, and line-ending changes. Use **All lines** to include unchanged lines. Search and filter the file list to find a specific change.

UTF-8 and BOM-marked UTF-16 text is supported. Binary files and other encodings are compared byte for byte and listed with their sizes. Large rewrites may display the entire changed section as a replacement.

The downloaded HTML report includes every file and all text lines, and opens independently in a browser.

Directory selection requires a browser that supports folder uploads. Empty directories are not included.
