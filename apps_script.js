const GITHUB_USERNAME = '<GitHub Username>';
const GITHUB_REPO_NAME = '<GitHub Repo Name>';
const PDF_FOLDER_NAME_IN_REPO = 'pdfs';
const HTML_FOLDER_NAME_IN_REPO = 'html-previews';
const COMMIT_MESSAGE_PREFIX = 'Form Submission: ';
const DRIVE_FOLDER_ID='<Google Drive Folder ID>';

function deleteAllFilesInFolder() {
  try {
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const files = folder.getFiles();
    let deletedCount = 0;

    while (files.hasNext()) {
      const file = files.next();
      Drive.Files.remove(file.getId());
      deletedCount++;
      Logger.log(`Permanently deleted file '${file.getName()}' (ID: ${file.getId()}).`);
    }

    Logger.log(`Successfully permanently deleted ${deletedCount} files from folder '${folder.getName()}'.`);

  } catch (e) {
    Logger.log(`An error occurred while deleting files from folder ${DRIVE_FOLDER_ID}: ${e.message}`);
  }
}


function getFormResponseById(formId, responseId) {
  try {
    const form = FormApp.openById(formId);
    const response = form.getResponse(responseId);
    if (response) {
      Logger.log(`Successfully retrieved response with ID: ${responseId}`);
      return response;
    } else {
      Logger.log(`Response with ID ${responseId} not found in form ${formId}.`);
      return null;
    }
  } catch (e) {
    Logger.log(`Error retrieving form response ${responseId} from form ${formId}: ${e.message}`);
    return null;
  }
}

function onFormSubmit(e) {
  try {
    const formResponse = e.response;
    const formId = e.source.getId();
    const responseId = formResponse.getId();

    const itemResponses = [
      getFormResponseById(formId, responseId).getItemResponses()[0]
    ];

    Logger.log(`Form ID: ${formId}`);
    Logger.log(`Response ID: ${responseId}`);

    let pdfFile = null;
    let pdfFileName = '';
    let pdfFileId = '';

    for (const itemResponse of itemResponses) {
      Logger.log(itemResponse.getItem());
      Logger.log(itemResponse.getItem().getId());
      Logger.log(itemResponse.getResponse());

      const fileId = itemResponse.getResponse()[0];
      if (fileId && fileId.length > 0) {
        pdfFile = DriveApp.getFileById(fileId);

        if (pdfFile.getMimeType() === MimeType.PDF) {
          pdfFileName = pdfFile.getName();
          Logger.log(`Found PDF file: ${pdfFileName} (ID: ${pdfFileId})`);
          break;
        } else {
          Logger.log(`Found a file, but it's not a PDF: ${pdfFile.getName()} (${pdfFile.getMimeType()})`);
        }
      }      

    }

    if (!pdfFile) {
      Logger.log('No PDF file found in the form submission. Exiting.');
      return;
    }

    const githubToken = '<GitHub PAT from secure storage>';
    if (!githubToken) {
      Logger.log('GitHub Personal Access Token not found in User Properties. Please set it up.');
      throw new Error('GitHub token missing.');
    }

    const pdfBlob = pdfFile.getBlob();
    const pdfContentBase64 = Utilities.base64Encode(pdfBlob.getBytes());
    const pdfPathInRepo = `${PDF_FOLDER_NAME_IN_REPO}/bulletin.pdf`;
    const pdfCommitMessage = `${COMMIT_MESSAGE_PREFIX}Add bulletin.pdf`;

    Logger.log(`Attempting to push PDF: ${pdfPathInRepo}`);
    const pdfPushResult = pushFileToGitHub(
      GITHUB_USERNAME,
      GITHUB_REPO_NAME,
      pdfPathInRepo,
      pdfContentBase64,
      pdfCommitMessage,
      githubToken
    );

    if (pdfPushResult.success) {
      Logger.log(`Successfully pushed PDF: ${pdfPathInRepo}`);

      const htmlFileName = 'index.html';
      const htmlPathInRepo = `${htmlFileName}`;
      const timestamp = new Date().getTime();
      const githubPagesPdfUrl = `https://${GITHUB_USERNAME}.github.io/${PDF_FOLDER_NAME_IN_REPO}/bulletin.pdf?t=${timestamp}`;      
      const htmlContent = generateHtmlContent(githubPagesPdfUrl);
      const htmlContentBase64 = Utilities.base64Encode(htmlContent);
      const htmlCommitMessage = `${COMMIT_MESSAGE_PREFIX}Update HTML redirect for ${pdfFileName}`;

      Logger.log(`Attempting to push HTML: ${htmlPathInRepo}`);
      const htmlPushResult = pushFileToGitHub(
        GITHUB_USERNAME,
        GITHUB_REPO_NAME,
        htmlPathInRepo,
        htmlContentBase64,
        htmlCommitMessage,
        githubToken
      );

      if (htmlPushResult.success) {
        Logger.log(`Successfully pushed HTML: ${htmlPathInRepo}`);
        Logger.log(`Redirect available at: https://${GITHUB_USERNAME}.github.io/${HTML_FOLDER_NAME_IN_REPO}/${htmlFileName}`);

        Logger.log(`Cleaning up: Deleting PDF from Drive (${pdfFileId}) and Form Response (${responseId}).`);
        deleteAllFilesInFolder();
        deleteFormResponse(formId, responseId);
        Logger.log('Cleanup complete.');

      } else {
        Logger.log(`Failed to push HTML file: ${htmlPushResult.error}`);
      }
    } else {
      Logger.log(`Failed to push PDF file: ${pdfPushResult.error}`);
    }

  } catch (error) {
    Logger.log(`An error occurred: ${error.message}`);
  }
}

function getGitHubAccessToken() {
  const userProperties = PropertiesService.getUserProperties();
  Logger.log(userProperties.getProperties());
  return userProperties.getProperty('GITHUB_TOKEN');
}

function pushFileToGitHub(owner, repo, filePath, fileContentBase64, commitMessage, token) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };

  Logger.log(`API URL: ${apiUrl}`);

  let existingSha = null;

  try {
    const getOptions = {
      'method': 'get',
      'headers': headers,
      'muteHttpExceptions': true
    };
    const getResponse = UrlFetchApp.fetch(apiUrl, getOptions);
    const getResponseCode = getResponse.getResponseCode();

    if (getResponseCode === 200) {
      const fileData = JSON.parse(getResponse.getContentText());
      existingSha = fileData.sha;
      Logger.log(`File ${filePath} already exists. SHA: ${existingSha}`);
    } else if (getResponseCode === 404) {
      Logger.log(`File ${filePath} does not exist. Will create new.`);
    } else {
      Logger.log(`Error getting file ${filePath}: ${getResponseCode} - ${getResponse.getContentText()}`);
      return { success: false, error: `Failed to check existing file: ${getResponse.getContentText()}` };
    }
  } catch (e) {
    Logger.log(`Exception while checking file existence: ${e.message}`);
    return { success: false, error: `Exception during file existence check: ${e.message}` };
  }

  const payload = {
    message: commitMessage,
    content: fileContentBase64,
    branch: 'main'
  };

  if (existingSha) {
    payload.sha = existingSha;
  }

  const options = {
    'method': 'put',
    'headers': headers,
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode === 200 || responseCode === 201) {
      Logger.log(`GitHub API success for ${filePath}: ${responseCode}`);
      return { success: true };
    } else {
      Logger.log(`GitHub API error for ${filePath}: ${responseCode} - ${responseText}`);
      return { success: false, error: responseText };
    }
  } catch (e) {
    Logger.log(`Exception during GitHub API call for ${filePath}: ${e.message}`);
    return { success: false, error: e.message };
  }
}

function generateHtmlContent(githubPagesPdfUrl) {
  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="refresh" content="0; url=${githubPagesPdfUrl}">
    <title>Redirecting...</title>
</head>
<body>
    <p>If you are not redirected automatically, follow this <a href="${githubPagesPdfUrl}">link to the PDF</a>.</p>
</body>
</html>`;
}

function deleteFormResponse(formId, responseId) {
  try {
    const form = FormApp.openById(formId);
    form.deleteResponse(responseId);
    Logger.log(`Form response with ID ${responseId} deleted from form ${formId}.`);
  } catch (e) {
    Logger.log(`Error deleting form response ${responseId}: ${e.message}`);
  }
}
