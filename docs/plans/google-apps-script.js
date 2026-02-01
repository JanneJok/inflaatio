function tarkistaJaPaivitaInflaatio() {
  // Haetaan viimeksi LÄHETETTY data Script Propertiesista
  const scriptProps = PropertiesService.getScriptProperties();
  const viimeksiLahetettyKuukausi = scriptProps.getProperty('LAST_EMAIL_MONTH');
  const viimeksiLahetettyInflaatio = scriptProps.getProperty('LAST_EMAIL_INFLATION');

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

  const uusinAPIKuukausi = labelMap[sortedPeriods[sortedPeriods.length - 1]];
  const inflaatiot = sortedPeriods.map((k, i) => data.value[i]);
  const uusinAPIInflaatio = inflaatiot[inflaatiot.length - 1];

  // Tarkista onko kuukausi TAI inflaatioarvo muuttunut VERRATTUNA VIIMEKSI LÄHETETTYYN
  let kuukausiMuuttunut = false;
  let inflaatioMuuttunut = false;

  if (viimeksiLahetettyKuukausi === null) {
    // Ensimmäinen ajo - lähetetään aina
    kuukausiMuuttunut = true;
    Logger.log("Ensimmäinen ajo - lähetetään ilmoitus");
  } else {
    kuukausiMuuttunut = (uusinAPIKuukausi !== viimeksiLahetettyKuukausi);

    if (viimeksiLahetettyInflaatio !== null) {
      const edellinenInflaatio = parseFloat(viimeksiLahetettyInflaatio);
      inflaatioMuuttunut = Math.abs(uusinAPIInflaatio - edellinenInflaatio) > 0.001;
    }
  }

  // Päivitä Sheet ja lähetä sähköposti VAIN jos muutos
  if (kuukausiMuuttunut || inflaatioMuuttunut) {
    if (kuukausiMuuttunut && inflaatioMuuttunut) {
      Logger.log(`Muutos havaittu: kuukausi (${viimeksiLahetettyKuukausi} → ${uusinAPIKuukausi}) JA inflaatio (${viimeksiLahetettyInflaatio}% → ${uusinAPIInflaatio}%)`);
    } else if (kuukausiMuuttunut) {
      Logger.log(`Muutos havaittu: kuukausi (${viimeksiLahetettyKuukausi} → ${uusinAPIKuukausi})`);
    } else {
      Logger.log(`Muutos havaittu: inflaatio samalle kuukaudelle ${uusinAPIKuukausi} (${viimeksiLahetettyInflaatio}% → ${uusinAPIInflaatio}%)`);
    }

    // Päivitä Sheet (vain kun data muuttunut)
    Logger.log("Päivitetään Google Sheets...");
    haeInflaatioDataJaMetrics(data, indexData);

    // Lähetä sähköposti
    const vastaanottaja = "janne.jokela@live.fi";
    lahetaIlmoitusSahkopostiin(uusinAPIKuukausi, uusinAPIInflaatio, vastaanottaja);

    // Tallenna viimeksi lähetetty tieto
    scriptProps.setProperty('LAST_EMAIL_MONTH', uusinAPIKuukausi);
    scriptProps.setProperty('LAST_EMAIL_INFLATION', uusinAPIInflaatio.toString());

    Logger.log("✓ Sheet päivitetty, sähköposti lähetetty");
  } else {
    Logger.log(`Ei muutoksia viimeksi lähetettyyn verrattuna: kuukausi ${uusinAPIKuukausi}, inflaatio ${uusinAPIInflaatio}%`);
    Logger.log("Sheet pysyy ennallaan, ei sähköpostia");
  }
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
function lahetaIlmoitusSahkopostiin(kuukausi, inflaatio, vastaanottaja) {
  const aihe = `Inflaatiodata päivitetty (${kuukausi})`;
  const viesti = `Hei!

Eurostatin inflaatiodata on päivittynyt kuukaudelle ${kuukausi}.
Uusin inflaatioarvo: ${inflaatio} %

Tiedot on nyt päivitetty Google Sheetiin.

Terveisin,
Inflaatio-botti`;

  MailApp.sendEmail(vastaanottaja, aihe, viesti);
}

// ========================================
// HUOMIO: Script Properties -muistin nollaus
// ========================================
// Jos haluat testata sähköpostin lähetystä uudelleen,
// aja tämä funktio kerran:
function nollaaLahetettyTieto() {
  const scriptProps = PropertiesService.getScriptProperties();
  scriptProps.deleteProperty('LAST_EMAIL_MONTH');
  scriptProps.deleteProperty('LAST_EMAIL_INFLATION');
  Logger.log("✓ Viimeksi lähetetty tieto nollattu - seuraava ajo lähettää sähköpostin");
}
