function tarkistaJaPaivitaInflaatio() {
  let eurostatMuuttunut = false;
  let tilastokeskusMuuttunut = false;
  let uusinHICPKuukausi, uusinHICPInflaatio;

  // ========================================
  // 1. TARKISTA EUROSTAT HICP-DATA
  // ========================================
  Logger.log("=== Tarkistetaan Eurostat HICP-data ===");

  const url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr?geo=FI&coicop=CP00&unit=RCH_A';
  const indexUrl = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_midx?geo=FI&coicop=CP00&unit=I15';

  const response = UrlFetchApp.fetch(url);
  const data = JSON.parse(response.getContentText());

  const indexResponse = UrlFetchApp.fetch(indexUrl);
  const indexData = JSON.parse(indexResponse.getContentText());

  const indexMap = data.dimension.time.category.index;
  const labelMap = data.dimension.time.category.label;
  const sortedPeriods = Object.entries(indexMap)
    .sort((a, b) => a[1] - b[1])
    .map(entry => entry[0]);

  uusinHICPKuukausi = labelMap[sortedPeriods[sortedPeriods.length - 1]];
  const inflaatiot = sortedPeriods.map((k, i) => data.value[i]);
  uusinHICPInflaatio = inflaatiot[inflaatiot.length - 1];

  // Lue viimeisin kuukausi suoraan sheetistä — ei Script Properties
  // Huom: getValue() palauttaa Date-objektin jos Google Sheets tulkitsee solun päivämääräksi
  const hicpSheet = getOrCreateSheet("Raakadata");
  const hicpLastRow = hicpSheet.getLastRow();
  const viimHICPKkSheetissa = hicpLastRow > 1 ? sheetArvoStringiksi(hicpSheet.getRange(hicpLastRow, 1).getValue()) : null;

  if (viimHICPKkSheetissa !== uusinHICPKuukausi) {
    eurostatMuuttunut = true;
    Logger.log(`HICP muuttunut: ${viimHICPKkSheetissa} → ${uusinHICPKuukausi}`);
  } else {
    Logger.log(`HICP ei muutoksia: ${uusinHICPKuukausi}, ${uusinHICPInflaatio}%`);
  }

  if (eurostatMuuttunut) {
    Logger.log("Päivitetään Eurostat HICP-data...");
    haeInflaatioDataJaMetrics(data, indexData);
  }

  // ========================================
  // 2. TARKISTA TILASTOKESKUKSEN CPI-DATA
  // ========================================
  Logger.log("=== Tarkistetaan Tilastokeskus CPI-data ===");

  try {
    const cpiUrl = 'https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/khi/statfin_khi_pxt_122p.px';
    const cpiQuery = {
      "query": [{
        "code": "Kuukausi",
        "selection": {
          "filter": "all",
          "values": ["*"]
        }
      }],
      "response": {
        "format": "json-stat2"
      }
    };

    const cpiOpts = {
      'method': 'post',
      'contentType': 'application/json',
      'payload': JSON.stringify(cpiQuery),
      'muteHttpExceptions': true
    };

    const cpiResp = UrlFetchApp.fetch(cpiUrl, cpiOpts);
    if (cpiResp.getResponseCode() !== 200) {
      throw new Error(`Inflaatio-API palautti ${cpiResp.getResponseCode()}: ${cpiResp.getContentText()}`);
    }
    const cpiData = JSON.parse(cpiResp.getContentText());

    const cpiLabels = cpiData.dimension.Kuukausi.category.label;
    const cpiValues = cpiData.value;
    const cpiCodes = Object.keys(cpiLabels);
    const viimCPICode = cpiCodes[cpiCodes.length - 1];

    // Muuta "2025M12" → "2025-12"
    const parts = viimCPICode.split('M');
    const uusiCPIKk = parts[0] + '-' + parts[1];
    const uusiCPIInfl = cpiValues[cpiValues.length - 1];

    // Lue viimeisin kuukausi suoraan sheetistä — ei Script Properties
    const cpiSheet = getOrCreateSheet("Raakadata CPI");
    const cpiLastRow = cpiSheet.getLastRow();
    const viimCPIKkSheetissa = cpiLastRow > 1 ? sheetArvoStringiksi(cpiSheet.getRange(cpiLastRow, 1).getValue()) : null;

    if (viimCPIKkSheetissa !== uusiCPIKk) {
      tilastokeskusMuuttunut = true;
      Logger.log(`CPI muuttunut: ${viimCPIKkSheetissa} → ${uusiCPIKk}`);
    } else {
      Logger.log(`CPI ei muutoksia: ${uusiCPIKk}, ${uusiCPIInfl}%`);
    }

    if (tilastokeskusMuuttunut) {
      Logger.log("Päivitetään Tilastokeskus CPI-data...");
      haeTilastokeskusData();
    }

  } catch (error) {
    Logger.log("❌ Virhe Tilastokeskuksen datan tarkistuksessa: " + error.toString());
  }

  // ========================================
  // 3. LÄHETÄ SÄHKÖPOSTI JOS MUUTOKSIA
  // ========================================
  if (eurostatMuuttunut || tilastokeskusMuuttunut) {
    let lahde = "";
    if (eurostatMuuttunut && tilastokeskusMuuttunut) {
      lahde = "Eurostat HICP ja Tilastokeskus CPI";
    } else if (eurostatMuuttunut) {
      lahde = "Eurostat HICP";
    } else {
      lahde = "Tilastokeskus CPI";
    }

    Logger.log(`✓ Dataa päivitetty (${lahde}), lähetetään sähköposti`);
    const vastaanottaja = "janne.jokela@live.fi";
    lahetaIlmoitusSahkopostiin(uusinHICPKuukausi, uusinHICPInflaatio, lahde, vastaanottaja);
  } else {
    Logger.log("Ei muutoksia kummassakaan datassa");
  }
}

// Muuntaa sheettisolu "2025-12"-muotoon — getValue() palauttaa Date-objektin
// jos Google Sheets on tulkinnut solun päivämääräksi
function sheetArvoStringiksi(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM");
  }
  return val ? val.toString() : null;
}

function haeInflaatioDataJaMetrics(data, indexData) {
  const indexMap = data.dimension.time.category.index;
  const labelMap = data.dimension.time.category.label;
  const values = data.value;
  const indexValues = indexData.value;

  const sortedPeriods = Object.entries(indexMap)
    .sort((a, b) => a[1] - b[1])
    .map(entry => entry[0]);

  const labels = sortedPeriods.map(k => labelMap[k]);
  const inflaatiot = sortedPeriods.map((k, i) => values[i]);
  const indeksit = sortedPeriods.map((k, i) => indexValues[i]);

  const unitLabel = data.dimension.unit.category.label["RCH_A"];
  const geoLabel = data.dimension.geo.category.label["FI"];
  const coicopLabel = data.dimension.coicop.category.label["CP00"];

  const raakadataSheet = getOrCreateSheet("Raakadata");
  raakadataSheet.clearContents();
  raakadataSheet.appendRow(["Kuukausi", "Inflaatio %", "Indeksi", "Yksikkö", "Alue", "Kategoria"]);
  for (let i = 0; i < labels.length; i++) {
    const inflaatio = values[i] !== undefined ? values[i] + " %" : "—";
    const indeksi = indeksit[i] !== undefined ? indeksit[i] : "—";
    raakadataSheet.appendRow([labels[i], inflaatio, indeksi, unitLabel, geoLabel, coicopLabel]);
  }

  const metricsSheet = getOrCreateSheet("Key Metrics");
  metricsSheet.clearContents();
  metricsSheet.appendRow(["Mittari", "Arvo"]);

  const viimeisin = inflaatiot[inflaatiot.length - 1];
  const edellinen = inflaatiot[inflaatiot.length - 2];
  const vuosiSitten = inflaatiot[inflaatiot.length - 13];
  const viimeiset12 = inflaatiot.slice(-12);
  const keski12kk = average(viimeiset12);

  const nykVuosi = new Date().getFullYear().toString();
  const ytdArvot = [];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i].startsWith(nykVuosi)) {
      ytdArvot.push(inflaatiot[i]);
    }
  }
  const ytdKeski = average(ytdArvot);

  metricsSheet.appendRow(["Viimeisin inflaatio", formatValue(viimeisin)]);
  metricsSheet.appendRow(["Muutos edelliseen kuukauteen", formatValue(viimeisin - edellinen)]);
  metricsSheet.appendRow(["12 kk keskiarvo", formatValue(keski12kk)]);
  metricsSheet.appendRow(["Vuoden alun keskiarvo", formatValue(ytdKeski)]);
  metricsSheet.appendRow(["Sama kuukausi vuotta aiemmin", formatValue(vuosiSitten)]);
}

// Apufunktiot
function average(arr) {
  const sum = arr.reduce((acc, v) => acc + v, 0);
  return sum / arr.length;
}
function formatValue(value) {
  return value !== undefined ? value.toFixed(1) + " %" : "—";
}
function getOrCreateSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}
function lahetaIlmoitusSahkopostiin(kuukausi, inflaatio, lahde, vastaanottaja) {
  const aihe = `Inflaatiodata päivitetty (${kuukausi})`;
  const viesti = `Hei!

Inflaatiodata on päivittynyt kuukaudelle ${kuukausi}.
Lähde: ${lahde}
Uusin inflaatioarvo (HICP): ${inflaatio} %

Tiedot on nyt päivitetty Google Sheetiin.

Terveisin,
Inflaatio-botti`;

  MailApp.sendEmail(vastaanottaja, aihe, viesti);
}

// ========================================
// TILASTOKESKUKSEN CPI-DATA
// ========================================

function haeTilastokeskusData() {
  try {
    const inflUrl = 'https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/khi/statfin_khi_pxt_122p.px';
    const inflQuery = {
      "query": [{
        "code": "Kuukausi",
        "selection": {
          "filter": "all",
          "values": ["*"]
        }
      }],
      "response": {
        "format": "json-stat2"
      }
    };

    const inflOpts = {
      'method': 'post',
      'contentType': 'application/json',
      'payload': JSON.stringify(inflQuery),
      'muteHttpExceptions': true
    };

    const inflResp = UrlFetchApp.fetch(inflUrl, inflOpts);
    if (inflResp.getResponseCode() !== 200) {
      throw new Error(`Inflaatio-API palautti ${inflResp.getResponseCode()}: ${inflResp.getContentText()}`);
    }
    const inflData = JSON.parse(inflResp.getContentText());

    // Hae indeksidata — jos epäonnistuu, jatketaan ilman indeksiä
    let idxData = null;
    const idxUrl = 'https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/khi/statfin_khi_pxt_11xs.px';
    const idxQuery = {
      "query": [
        {
          "code": "Kuukausi",
          "selection": {
            "filter": "all",
            "values": ["*"]
          }
        },
        {
          "code": "Indeksisarja",
          "selection": {
            "filter": "item",
            "values": ["0_2015"]
          }
        }
      ],
      "response": {
        "format": "json-stat2"
      }
    };

    const idxOpts = {
      'method': 'post',
      'contentType': 'application/json',
      'payload': JSON.stringify(idxQuery),
      'muteHttpExceptions': true
    };

    const idxResp = UrlFetchApp.fetch(idxUrl, idxOpts);
    if (idxResp.getResponseCode() === 200) {
      idxData = JSON.parse(idxResp.getContentText());
    } else {
      Logger.log(`⚠️ Indeksi-API palautti ${idxResp.getResponseCode()} — tallennetaan ilman indeksiä, back-calculation laskee puuttuvat`);
    }

    tallennaTilastokeskusData(inflData, idxData);
    Logger.log("✓ Tilastokeskuksen CPI-data haettu ja tallennettu");

  } catch (error) {
    Logger.log("❌ Virhe Tilastokeskuksen datan haussa: " + error.toString());
  }
}

function tallennaTilastokeskusData(inflData, idxData) {
  const labels = inflData.dimension.Kuukausi.category.label;
  const inflVals = inflData.value;

  // Rakenna indeksi-hakumap — idxData voi olla null jos API epäonnistui
  const idxMap = {};
  if (idxData) {
    const idxLabels = idxData.dimension.Kuukausi.category.label;
    Object.keys(idxLabels).forEach((code, i) => {
      idxMap[code] = idxData.value[i];
    });
  }

  // Collect all months into sortable array
  const inflCodes = Object.keys(labels);
  const months = [];
  inflCodes.forEach((code, i) => {
    if (inflVals[i] === null || inflVals[i] === undefined) return;
    const parts = code.split('M');
    months.push({
      code: code,
      date: parts[0] + '-' + parts[1],
      inflation: inflVals[i],
      index: (idxMap[code] !== null && idxMap[code] !== undefined) ? idxMap[code] : null
    });
  });
  months.sort((a, b) => a.code.localeCompare(b.code));

  // Back-calculate missing indices: index[M] = index[M+12] / (1 + inflation[M+12] / 100)
  const codeToI = {};
  months.forEach((m, i) => { codeToI[m.code] = i; });

  let backCalcCount = 0;
  for (let i = months.length - 1; i >= 0; i--) {
    if (months[i].index !== null) continue;
    const parts = months[i].code.split('M');
    const futureCode = (parseInt(parts[0]) + 1) + 'M' + parts[1];
    const fi = codeToI[futureCode];
    if (fi !== undefined && months[fi].index !== null) {
      months[i].index = months[fi].index / (1 + months[fi].inflation / 100);
      backCalcCount++;
    }
  }

  // Write to sheet
  const sheet = getOrCreateSheet("Raakadata CPI");
  sheet.clearContents();
  sheet.appendRow(["Kuukausi", "Inflaatio %", "Indeksi", "Lähde", "Indeksisarja"]);

  months.forEach(m => {
    const inflStr = m.inflation.toFixed(1) + " %";
    const idxStr = m.index !== null ? m.index.toFixed(1) : "—";
    sheet.appendRow([m.date, inflStr, idxStr, "Tilastokeskus", "2015=100"]);
  });

  Logger.log(`✓ Tallennettu ${months.length} kuukauden CPI-data (${backCalcCount} indeksia back-calculated)`);
}
