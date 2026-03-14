/**
 * Google Apps Script — ML Experiment Tracker backend
 *
 * HOW TO DEPLOY:
 * 1. Open your Google Sheet:
 *    https://docs.google.com/spreadsheets/d/1DG-xLRM9wnNccXowsMqlbcxbSAScQAez3FeuH1MN3xw
 * 2. Click Extensions → Apps Script
 * 3. Delete any existing code and paste ALL of this file
 * 4. Click Deploy → New deployment
 *    - Type: Web App
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Click Deploy, authorize when prompted
 * 6. Copy the Web App URL shown after deployment
 * 7. Open artifacts/ml-tracker/src/pages/MLTracker.tsx
 *    and set APPS_SCRIPT_URL to that URL
 *
 * SUPPORTED ACTIONS (all via GET parameters):
 *   ?action=add&model=X&dataset=Y&accuracy=0.95&notes=Z&date=YYYY-MM-DD
 *   ?action=delete&rowIndex=3   (rowIndex = sheet row number, 2 = first data row)
 *   (no action) → returns all rows as JSON
 */

var SHEET_ID = "1DG-xLRM9wnNccXowsMqlbcxbSAScQAez3FeuH1MN3xw";

function doGet(e) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheets()[0];
    var action = e.parameter.action;

    if (action === "add") {
      var model = e.parameter.model || "";
      var dataset = e.parameter.dataset || "";
      var accuracy = e.parameter.accuracy || "";
      var notes = e.parameter.notes || "";
      var date = e.parameter.date || "";
      sheet.appendRow([model, dataset, accuracy, notes, date]);
      return jsonOk({ success: true });
    }

    if (action === "delete") {
      var rowIndex = parseInt(e.parameter.rowIndex, 10);
      if (isNaN(rowIndex) || rowIndex < 2) {
        return jsonError("Invalid rowIndex: must be >= 2");
      }
      var lastRow = sheet.getLastRow();
      if (rowIndex > lastRow) {
        return jsonError("Row " + rowIndex + " does not exist");
      }
      sheet.deleteRow(rowIndex);
      return jsonOk({ success: true });
    }

    // Default: return all rows as JSON
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return jsonOk([]);
    var headers = data[0].map(function (h) {
      return String(h).toLowerCase().trim();
    });
    var rows = data.slice(1).map(function (row, idx) {
      var obj = { id: idx + 2 };
      headers.forEach(function (h, i) {
        obj[h] = row[i];
      });
      return obj;
    });
    return jsonOk(rows);
  } catch (err) {
    return jsonError(String(err));
  }
}

function jsonOk(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function jsonError(message) {
  return ContentService.createTextOutput(
    JSON.stringify({ error: message }),
  ).setMimeType(ContentService.MimeType.JSON);
}
