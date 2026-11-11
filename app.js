"use strict";

/* ===================== Grundlagen ===================== */

const CFG = window.KLARGLAS || {};
const TABELLEN = ["kunden", "auftraege", "notizen", "ausgaben", "auszahlungen", "aufgaben", "verfuegbarkeit", "einstellungen", "kalender", "blocker", "mitarbeiter"];
const STATUS = [
  { id: "neu", name: "Neue Anfrage", farbe: "#2B5CFF" },
  { id: "kontakt", name: "In Kontakt", farbe: "#5B3FD6" },
  { id: "funkstille", name: "Funkstille", farbe: "#8A90A0" },
  { id: "geplant", name: "Termin geplant", farbe: "#E67C73" },
  { id: "termin", name: "Termin steht", farbe: "#D08A00" },
  { id: "erledigt", name: "Erledigt", farbe: "#0F7A4B" },
  { id: "stamm", name: "Stammkunde", farbe: "#010F2B" },
  { id: "abgesagt", name: "Abgesagt", farbe: "#B5B9C3" },
];
const STATUS_NAME = Object.fromEntries(STATUS.map((s) => [s.id, s.name]));
const LEISTUNGEN = ["Fensterreinigung", "Felgenreinigung", "Nachbarschaftshilfe"];
// Termine ohne Geld, z. B. eine Besichtigung
const TERMIN_ARTEN = ["Besichtigung", "Rückruf", "Sonstiges"];
// Woher eine Nachricht im Verlauf kam
const NACHRICHT_QUELLEN = { notiz: "Notiz", email: "Mail vom Kunden", nebenan: "nebenan.de", whatsapp: "WhatsApp", telefon: "Telefonat" };
const KATEGORIEN = ["Putzmittel", "Werkzeug", "Fahrt", "Werbung", "Sonstiges"];
const PERSONEN = ["Louis", "Lukas"];
// Preise stehen in den Einstellungen (Dashboard → Einstellungen); das hier ist nur der Rückfall
const PREIS_STANDARD = { preis_normal: 5, preis_boden: 10, mindestpreis: 25, stundensatz: 15 };
const STAMM_AB = 3; // bezahlte Besuche, ab denen jemand Stammkunde ist

const daten = Object.fromEntries(TABELLEN.map((t) => [t, []]));
const zustand = { kundenFilter: "alle", suche: "", kundenAnsicht: "kunden", auftraegeZeitraum: null, geldZeitraum: "monat", geldStichtag: new Date(), geldPillePrev: null, aufgabenFilter: "offen", kalenderPruefung: null };
// Wie viele Monate das Wochen-Diagramm (Ansicht Monat) zeigt: 2, 3, 6, 12 oder "alles"; wird gemerkt
const CHART_MONATE = [2, 3, 6, 12, "alles"];
zustand.chartMonate = (() => {
  try {
    const v = localStorage.getItem("klarglas-chart-monate");
    return v === "alles" ? "alles" : [2, 3, 6, 12].includes(Number(v)) ? Number(v) : 2;
  } catch { return 2; }
})();
function chartMonateSetzen(wert) {
  zustand.chartMonate = wert === "alles" ? "alles" : Number(wert) || 2;
  try { localStorage.setItem("klarglas-chart-monate", String(zustand.chartMonate)); } catch {}
}
let ich = "Test";
let db = null;

const $ = (sel, wurzel = document) => wurzel.querySelector(sel);
const inhalt = $("[data-inhalt]");

const esc = (wert) =>
  String(wert ?? "").replace(/[&<>"']/g, (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[z]);

const zahl = (wert) => (wert === null || wert === undefined || wert === "" ? null : Number(wert));

const euro = (wert) => {
  const n = Number(wert) || 0;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
};

const fmtTag = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
const fmtTagLang = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const fmtDatum = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", year: "2-digit" });
const fmtUhr = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const fmtMonat = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const fmtDatumKurz = (d) => `${d.getDate()}.${d.getMonth() + 1}.`;
const fmtMonatKurz = new Intl.DateTimeFormat("de-DE", { month: "short" });
const fmtWochentag = new Intl.DateTimeFormat("de-DE", { weekday: "long" });
const fmtTagMonat = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long" });

const isoAusDatum = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const heuteIso = () => isoAusDatum(new Date());

// „Wieder melden“-Aufgaben erst 3 Tage vor dem fälligen Tag in den Listen zeigen (Push kommt trotzdem am Tag)
const istWiederAufgabe = (a) => /: wieder .+ anbieten$/.test(a.titel || "");
const aufgabeSichtbar = (a) => a.erledigt || !istWiederAufgabe(a) || !a.faellig || a.faellig <= isoAusDatum(new Date(Date.now() + 3 * 86400000));
const sichtbareAufgaben = () => daten.aufgaben.filter(aufgabeSichtbar);

// <input type="datetime-local"> ↔ ISO-Zeit
function lokalZuIso(wert) {
  return wert ? new Date(wert).toISOString() : null;
}

function isoZuLokal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ===================== Datenhaltung ===================== */

let supa = null; // Supabase-Client, wenn nicht im Testmodus

// Bestätigen/Ablehnen läuft über die Edge Function, weil sie den Google-Kalender anfasst
async function kalenderPruefen() {
  if (db.lokal) return { dienstkonto: "klarglas@beispiel.iam.gserviceaccount.com", kalender: Object.fromEntries(daten.kalender.map((k) => [k.kalender_id, "ok"])) };
  const { data: { session } } = await supa.auth.getSession();
  const res = await fetch(`${CFG.SUPABASE_URL}/functions/v1/bestaetigen`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ aktion: "kalender_pruefen" }),
  });
  const antwort = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(antwort.fehler || antwort.message || `Status ${res.status}`);
  return antwort;
}

async function terminAktion(auftragId, aktion) {
  const { data: { session } } = await supa.auth.getSession();
  const res = await fetch(`${CFG.SUPABASE_URL}/functions/v1/bestaetigen`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ auftrag_id: auftragId, aktion }),
  });
  if (!res.ok) {
    const antwort = await res.json().catch(() => ({}));
    throw new Error(antwort.fehler || antwort.message || `Status ${res.status}`);
  }
  await Promise.all(["auftraege", "kunden", "notizen"].map(laden));
}

// Testmodus: alles im Browser, damit man ohne Supabase ausprobieren kann
function lokaleDb() {
  const SCHLUESSEL = "klarglas-intern-test";
  const lesen = () => {
    try {
      return JSON.parse(localStorage.getItem(SCHLUESSEL)) || {};
    } catch {
      return {};
    }
  };
  const schreiben = (alles) => {
    try {
      localStorage.setItem(SCHLUESSEL, JSON.stringify(alles));
    } catch {
      /* privater Modus: dann eben nur bis zum Neuladen */
    }
  };
  let speicher = lesen();
  const tabelle = (t) => (speicher[t] = speicher[t] || []);

  // Standardwerte beim Start, wenn leer
  if (!speicher.verfuegbarkeit || speicher.verfuegbarkeit.length === 0) {
    speicher.verfuegbarkeit = [
      { id: crypto.randomUUID(), wochentag: 1, von: "15:00", bis: "19:00" },
      { id: crypto.randomUUID(), wochentag: 2, von: "15:00", bis: "19:00" },
      { id: crypto.randomUUID(), wochentag: 3, von: "15:00", bis: "19:00" },
      { id: crypto.randomUUID(), wochentag: 4, von: "15:00", bis: "19:00" },
      { id: crypto.randomUUID(), wochentag: 5, von: "15:00", bis: "19:00" },
      { id: crypto.randomUUID(), wochentag: 6, von: "09:00", bis: "17:00" },
    ];
  }
  if (!speicher.einstellungen || speicher.einstellungen.length === 0) {
    speicher.einstellungen = [
      { id: 1, slot_minuten: 60, puffer_min: 30, slot_schritt: 30, vorlauf_stunden: 12, tage_voraus: 14, anteil_prozent: 25, allein_prozent: 85, beide_louis_prozent: 50, ...PREIS_STANDARD },
    ];
  }
  schreiben(speicher);

  return {
    lokal: true,
    async list(t) {
      return structuredClone(tabelle(t));
    },
    async insert(t, zeile) {
      const neu = { id: crypto.randomUUID(), erstellt: new Date().toISOString(), ...zeile };
      tabelle(t).push(neu);
      schreiben(speicher);
      return structuredClone(neu);
    },
    async update(t, id, aenderung) {
      const z = tabelle(t).find((x) => x.id === id);
      if (z) Object.assign(z, aenderung);
      schreiben(speicher);
      return structuredClone(z);
    },
    async remove(t, id) {
      speicher[t] = tabelle(t).filter((x) => x.id !== id);
      if (t === "kunden") {
        ["auftraege", "notizen"].forEach((u) => (speicher[u] = tabelle(u).filter((x) => x.kunde_id !== id)));
        tabelle("aufgaben").forEach((a) => a.kunde_id === id && (a.kunde_id = null));
      }
      // wie „on delete cascade“: Löhne eines gelöschten Auftrags fallen weg
      if (t === "auftraege") speicher.auszahlungen = tabelle("auszahlungen").filter((x) => x.auftrag_id !== id);
      schreiben(speicher);
    },
    abonnieren(neuLaden) {
      window.addEventListener("storage", (e) => {
        if (e.key !== SCHLUESSEL) return;
        speicher = lesen();
        TABELLEN.forEach(neuLaden);
      });
    },
  };
}

function supabaseDb(client) {
  const pruefen = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    lokal: false,
    async list(t) {
      return pruefen(await client.from(t).select("*").order("erstellt"));
    },
    async insert(t, zeile) {
      return pruefen(await client.from(t).insert(zeile).select().single());
    },
    async update(t, id, aenderung) {
      return pruefen(await client.from(t).update(aenderung).eq("id", id).select().single());
    },
    async remove(t, id) {
      pruefen(await client.from(t).delete().eq("id", id));
    },
    abonnieren(neuLaden) {
      client
        .channel("klarglas-alles")
        .on("postgres_changes", { event: "*", schema: "public" }, (p) => TABELLEN.includes(p.table) && neuLaden(p.table))
        .subscribe();
    },
  };
}

async function laden(t) {
  daten[t] = await db.list(t);
}

async function speichern(aktion, t, ...rest) {
  try {
    // Bei Aufträgen merken, welcher Kunde betroffen ist (vor dem Löschen/Ändern), damit sein Status nachzieht
    const kundenIds = t === "auftraege" ? betroffeneKunden(aktion, rest) : [];
    const ergebnis = await db[aktion](t, ...rest);
    await laden(t);
    for (const kid of kundenIds) await statusAbgleichen(kid);
    if (aktion === "remove" && t === "kunden") await Promise.all(["auftraege", "notizen", "aufgaben", "auszahlungen"].map(laden));
    if (aktion === "remove" && t === "auftraege") await laden("auszahlungen");
    return ergebnis;
  } catch (fehler) {
    zeigeToast(`Speichern hat nicht geklappt: ${fehler.message}`);
    throw fehler;
  }
}

function betroffeneKunden(aktion, rest) {
  if (aktion === "insert") return [rest[0]?.kunde_id].filter(Boolean);
  const alt = daten.auftraege.find((a) => a.id === rest[0])?.kunde_id;
  const neuK = aktion === "update" ? rest[1]?.kunde_id : null;
  return [...new Set([alt, neuK].filter(Boolean))];
}

const neu = (t, zeile) => speichern("insert", t, zeile);
const aendern = (t, id, aenderung) => speichern("update", t, id, aenderung);
const loeschen = (t, id) => speichern("remove", t, id);

function notiz(kundeId, text, automatisch = true) {
  return neu("notizen", { kunde_id: kundeId, text, autor: automatisch ? "Dashboard" : ich, automatisch });
}

/* ===================== Berechnungen ===================== */

const kundeVon = (id) => daten.kunden.find((k) => k.id === id);
const auftraegeVon = (id) => daten.auftraege.filter((a) => a.kunde_id === id);
const auftragDatum = (a) => new Date(a.datum || a.erstellt);
const istTermin = (a) => a.art === "termin";
// Überschrift eines Eintrags: bei Terminen die Art (z. B. Besichtigung), sonst die Leistung
const auftragTitel = (a) => (istTermin(a) ? a.titel || "Termin" : a.leistung);
// Name in Listen: Kunde, sonst bei Terminen ohne Kunde der Titel
const auftragName = (a) => kundeVon(a.kunde_id)?.name || (istTermin(a) ? auftragTitel(a) : "Unbekannt");

// Aktuelle Preise aus den Einstellungen, fehlende Werte mit dem Standard aufgefüllt
function preise() {
  const e = daten.einstellungen?.[0] || {};
  const p = {};
  for (const [feld, standard] of Object.entries(PREIS_STANDARD)) p[feld] = zahl(e[feld]) ?? standard;
  return p;
}

// Festpreis: keine Rechnung, der Preis wird von Hand eingetragen
function schaetzen({ leistung, fenster_normal, fenster_boden, stunden, preisart, stundensatz }) {
  const p = preise();
  if (leistung === "Fensterreinigung") {
    const summe = (Number(fenster_normal) || 0) * p.preis_normal + (Number(fenster_boden) || 0) * p.preis_boden;
    return summe ? Math.max(summe, p.mindestpreis) : null;
  }
  if (preisart === "fest") return null;
  const satz = zahl(stundensatz) ?? p.stundensatz;
  return stunden ? Math.round(Number(stunden) * satz * 100) / 100 : null;
}

const trinkgeld = (a) =>
  zahl(a.bekommen) !== null && zahl(a.geschaetzt) !== null ? Math.max(0, a.bekommen - a.geschaetzt) : 0;

const ZEITRAUM_POS = { woche: 0, monat: 1, jahr: 2 };
const MONATE_KURZ = ["Jan", "Feb", "März", "Apr", "Mai", "Juni", "Juli", "Aug", "Sep", "Okt", "Nov", "Dez"];
const WOCHENTAGE_KURZ = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const tagPlus = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const imZeitraum = (d, von, bis) => d >= von && d < bis;

// Montag der Woche, in der d liegt (Wochen beginnen montags)
const montagVon = (d) => tagPlus(d, -((d.getDay() + 6) % 7));

// ISO-Kalenderwoche aus dem Montag einer Woche
function kalenderWoche(montag) {
  const donnerstag = tagPlus(montag, 3);
  const tage = Math.round((donnerstag - new Date(donnerstag.getFullYear(), 0, 1)) / 86400000);
  return Math.floor(tage / 7) + 1;
}

// Grenzen des gewählten Zeitraums um den Stichtag, dazu der Vorzeitraum zum Vergleich
function zeitraumGrenzen(zeitraum, stichtag) {
  const j = stichtag.getFullYear();
  const m = stichtag.getMonth();
  if (zeitraum === "woche") {
    const von = montagVon(stichtag);
    const sonntag = tagPlus(von, 6);
    const tage =
      von.getMonth() === sonntag.getMonth()
        ? `${von.getDate()}.–${sonntag.getDate()}. ${MONATE_KURZ[sonntag.getMonth()]}`
        : `${von.getDate()}. ${MONATE_KURZ[von.getMonth()]}–${sonntag.getDate()}. ${MONATE_KURZ[sonntag.getMonth()]}`;
    return { von, bis: tagPlus(von, 7), vorVon: tagPlus(von, -7), vorBis: von, label: `KW ${kalenderWoche(von)} · ${tage}`, vergleich: "zur Vorwoche" };
  }
  if (zeitraum === "jahr") {
    return { von: new Date(j, 0, 1), bis: new Date(j + 1, 0, 1), vorVon: new Date(j - 1, 0, 1), vorBis: new Date(j, 0, 1), label: String(j), vergleich: "zum Vorjahr" };
  }
  return {
    von: new Date(j, m, 1),
    bis: new Date(j, m + 1, 1),
    vorVon: new Date(j, m - 1, 1),
    vorBis: new Date(j, m, 1),
    label: fmtMonat.format(new Date(j, m, 1)),
    vergleich: "zum Vormonat",
  };
}

// Stichtag um eine Einheit des Zeitraums verschieben
function zeitraumVerschieben(zeitraum, stichtag, um) {
  if (zeitraum === "woche") return tagPlus(stichtag, 7 * um);
  if (zeitraum === "jahr") return new Date(stichtag.getFullYear() + um, 0, 1);
  return new Date(stichtag.getFullYear(), stichtag.getMonth() + um, 1);
}

function bezahltImZeitraum(von, bis) {
  return daten.auftraege.filter((a) => zahl(a.bekommen) !== null && imZeitraum(auftragDatum(a), von, bis));
}

// Kennzahlen für einen beliebigen Zeitraum (von inklusive, bis exklusive)
function zahlenFuer(von, bis) {
  const bezahlt = bezahltImZeitraum(von, bis);
  const umsatz = bezahlt.reduce((s, a) => s + Number(a.bekommen), 0);
  const ausgaben = daten.ausgaben.filter((x) => imZeitraum(new Date(x.datum), von, bis)).reduce((s, x) => s + Number(x.betrag), 0);
  const ids = new Set(bezahlt.map((a) => a.id));
  const loehne = daten.auszahlungen.filter((x) => x.art === "lohn" && ids.has(x.auftrag_id)).reduce((s, x) => s + Number(x.betrag), 0);
  const gewinn = umsatz - ausgaben - loehne;
  return {
    umsatz,
    ausgaben,
    loehne,
    gewinn,
    marge: umsatz ? Math.round((gewinn / umsatz) * 100) : null,
    trinkgeld: bezahlt.reduce((s, a) => s + trinkgeld(a), 0),
    auftraege: bezahlt.length,
  };
}

function trinkgeldQuote(auftraege) {
  const bezahlt = auftraege.filter((a) => zahl(a.bekommen) !== null && zahl(a.geschaetzt) !== null && Number(a.geschaetzt) > 0);
  if (!bezahlt.length) return null;
  const summeGeschaetzt = bezahlt.reduce((s, a) => s + Number(a.geschaetzt), 0);
  if (!summeGeschaetzt) return null;
  const summeTrinkgeld = bezahlt.reduce((s, a) => s + trinkgeld(a), 0);
  return Math.round((summeTrinkgeld / summeGeschaetzt) * 100);
}

function kassenstand() {
  const rein = daten.auftraege.reduce((s, a) => s + (Number(a.bekommen) || 0), 0);
  const raus = daten.ausgaben.filter((x) => x.bezahlt_von === "Kasse").reduce((s, x) => s + Number(x.betrag), 0);
  const ausgezahlt = daten.auszahlungen.reduce((s, x) => s + Number(x.betrag), 0);
  return rein - raus - ausgezahlt;
}

// Seit v18 wird nichts mehr erstattet: Wer privat auslegt, bekommt es sofort aufs eigene Konto
const offeneErstattungen = () => [];

// Kanal eines Kunden: steht seit v18 nur beim Kunden; alte Kunden ohne Angabe: Kanal des ersten Auftrags
const kanalAusKunde = (k) => (KANAELE[k?.quelle] ? k.quelle : null);
function kanalVonKunde(k) {
  if (kanalAusKunde(k)) return k.quelle;
  return auftraegeVon(k.id).sort((a, b) => auftragDatum(a) - auftragDatum(b))[0]?.kanal || null;
}

// Auszahlungen, die als Anteil am Gewinn zählen (Erstattungen nicht)
const istAnteil = (x) => x.art !== "erstattung" && x.art !== "lohn" && !String(x.notiz || "").startsWith("Erstattung");

/* ---------- Löhne pro Auftrag ---------- */

const STANDARD_ANTEIL = 25;
const standardAnteil = () => zahl(daten.einstellungen?.[0]?.anteil_prozent) ?? STANDARD_ANTEIL;
const aktiveMitarbeiter = () => daten.mitarbeiter.filter((m) => m.aktiv !== false).sort((a, b) => a.name.localeCompare(b.name, "de"));
// Ohne Angabe waren Louis und Lukas zusammen da (so wie früher: alles in die Kasse)
const teamVon = (a) => (Array.isArray(a.team) && a.team.length ? a.team : [...PERSONEN]);
const prozentVon = (a) => zahl(a.anteil_prozent) ?? standardAnteil();

// Allein-Regel (85/15) und Beide-da-Teilung (Louis-Anteil in %) – stehen in den Einstellungen,
// werden beim Bezahlen in den Auftrag geschrieben und gelten dann fest für diesen Auftrag
const STANDARD_ALLEIN = 85;
const STANDARD_LOUIS = 50;
const alleinStandard = () => zahl(daten.einstellungen?.[0]?.allein_prozent) ?? STANDARD_ALLEIN;
const louisStandard = () => zahl(daten.einstellungen?.[0]?.beide_louis_prozent) ?? STANDARD_LOUIS;
const alleinVon = (a) => zahl(a.allein_prozent) ?? alleinStandard();
const louisVon = (a) => zahl(a.louis_prozent) ?? louisStandard();
const cent = (x) => Math.round(x * 100) / 100;

// Wie ein Betrag verteilt wird:
// – Mitarbeiter (z. B. Flo) kriegen ihren Anteil bar (loehne)
// – einer von euch allein: 85 % auf sein Konto, 15 % aufs Konto des anderen
// – einer von euch mit Mitarbeiter: erst der Mitarbeiter-Anteil, vom Rest 85/15 wie allein
// – ihr beide: Rest geteilt (Standard 50/50)
function lohnAufteilung({ bekommen, team, prozent, einzeln = {}, allein = alleinStandard(), louis = louisStandard() }) {
  const betrag = Number(bekommen) || 0;
  const chefs = PERSONEN.filter((p) => team.includes(p));
  const beideChefs = chefs.length === PERSONEN.length;
  const konto = Object.fromEntries(PERSONEN.map((p) => [p, 0]));
  const mitarbeiter = team.filter((n) => !PERSONEN.includes(n));
  const prozentFuer = (name) => zahl(einzeln?.[name]) ?? (Number(prozent) || 0);
  const loehne = mitarbeiter.map((name) => ({ name, prozent: prozentFuer(name), betrag: Math.round(betrag * prozentFuer(name)) / 100 }));
  let rest = betrag - loehne.reduce((s, l) => s + l.betrag, 0);
  let regel = "beide";
  if (chefs.length === 1) {
    regel = mitarbeiter.length ? "mit" : "allein";
    const er = chefs[0];
    const anderer = PERSONEN.find((p) => p !== er);
    rest = Math.max(0, cent(rest));
    konto[er] = cent((rest * (Number(allein) || 0)) / 100);
    konto[anderer] = cent(rest - konto[er]);
  } else {
    rest = Math.max(0, cent(rest));
    konto[PERSONEN[0]] += cent((rest * (Number(louis) || 0)) / 100);
    konto[PERSONEN[1]] += cent(rest - cent((rest * (Number(louis) || 0)) / 100));
  }
  PERSONEN.forEach((p) => (konto[p] = cent(konto[p])));
  const kasse = cent(betrag - loehne.reduce((s, l) => s + l.betrag, 0));
  const zuViel = loehne.reduce((s, l) => s + l.prozent, 0) > 100;
  return { loehne, konto, kasse, beideChefs, regel, zuViel };
}
const kontoAufteilung = (a) =>
  lohnAufteilung({ bekommen: a.bekommen, team: teamVon(a), prozent: prozentVon(a), einzeln: a.mitarbeiter_prozent || {}, allein: alleinVon(a), louis: louisVon(a) });

// Aufklappbarer Block „Prozente“ im Auftrag: jeder Mitarbeiter einzeln + Teilung Louis/Lukas.
// Vorausgefüllt mit dem, was für den Auftrag gilt (sonst Standard aus den Einstellungen).
function prozenteFeld(a) {
  const einzeln = a.mitarbeiter_prozent || {};
  const namen = [...aktiveMitarbeiter().map((m) => m.name)];
  teamVon(a).forEach((n) => !PERSONEN.includes(n) && !namen.includes(n) && namen.push(n));
  const zahlInput = (attr, wert) => `<span class="eingabe-euro"><input type="number" class="eingabe" inputmode="decimal" min="0" max="100" step="1" ${attr} value="${esc(wert)}" /><span aria-hidden="true">%</span></span>`;
  return `<details class="prozente" data-prozente data-allein="${esc(alleinVon(a))}" data-louis="${esc(louisVon(a))}">
    <summary><span>Prozente</span><small data-prozente-kurz></small></summary>
    <div class="prozente__inhalt">
      ${namen.map((n) => `<label class="feld" data-mp="${esc(n)}"><span>${esc(n)} (bar)</span>${zahlInput(`data-mp-wert="${esc(n)}"`, zahl(einzeln[n]) ?? prozentVon(a))}</label>`).join("")}
      <div class="feldreihe" data-chef-paar>
        <label class="feld"><span data-chef-name="0"></span>${zahlInput('data-chef="0"', "")}</label>
        <label class="feld"><span data-chef-name="1"></span>${zahlInput('data-chef="1"', "")}</label>
      </div>
      <small class="leise" data-chef-hinweis></small>
    </div>
  </details>`;
}

// Was gerade im Prozente-Block steht
function prozenteAusForm(form, a) {
  const box = $("[data-prozente]", form);
  if (!box) return { prozent: prozentVon(a), einzeln: a.mitarbeiter_prozent || {}, allein: alleinVon(a), louis: louisVon(a) };
  const einzeln = {};
  box.querySelectorAll("[data-mp-wert]").forEach((x) => (einzeln[x.dataset.mpWert] = zahl(x.value) ?? prozentVon(a)));
  return { prozent: prozentVon(a), einzeln, allein: Number(box.dataset.allein), louis: Number(box.dataset.louis) };
}

// Felder passend zum Team zeigen, die zwei Chef-Felder ergänzen sich immer zu 100
function prozenteEinrichten(form, a) {
  const box = $("[data-prozente]", form);
  if (!box) return;
  const chef = [...box.querySelectorAll("[data-chef]")];
  const modus = () => {
    const chefs = PERSONEN.filter((p) => teamAusForm(form).includes(p));
    return chefs.length === 2 ? { art: "louis", namen: PERSONEN } : chefs.length === 1 ? { art: "allein", namen: [chefs[0], PERSONEN.find((p) => p !== chefs[0])] } : null;
  };
  const zeigen = () => {
    const team = teamAusForm(form);
    box.querySelectorAll("[data-mp]").forEach((x) => (x.hidden = !team.includes(x.dataset.mp)));
    const m = modus();
    $("[data-chef-paar]", box).hidden = !m;
    if (m) {
      const wert = Number(box.dataset[m.art]);
      $('[data-chef-name="0"]', box).textContent = m.art === "allein" ? `${m.namen[0]} (vor Ort)` : m.namen[0];
      $('[data-chef-name="1"]', box).textContent = m.namen[1];
      if (document.activeElement !== chef[0]) chef[0].value = wert;
      if (document.activeElement !== chef[1]) chef[1].value = cent(100 - wert);
    }
    const ma = team.filter((n) => !PERSONEN.includes(n));
    $("[data-chef-hinweis]", box).textContent = !m ? "" : m.art === "louis"
      ? (ma.length ? "Teilung vom Rest nach den Mitarbeitern." : "So wird zwischen euch geteilt.")
      : (ma.length ? "Erst die Mitarbeiter, vom Rest diese Teilung." : "Einer allein: so wird geteilt.");
    const p = prozenteAusForm(form, a);
    $("[data-prozente-kurz]", box).textContent = [
      ...ma.map((n) => `${n} ${p.einzeln[n]} %`),
      ...(m ? [`${m.namen[0]} ${box.dataset[m.art]} / ${m.namen[1]} ${cent(100 - Number(box.dataset[m.art]))}`] : []),
    ].join(" · ");
  };
  chef.forEach((x, i) => x.addEventListener("input", () => {
    const m = modus();
    const v = zahl(x.value);
    if (!m || v === null) return;
    const wert = Math.min(100, Math.max(0, i === 0 ? v : 100 - v));
    box.dataset[m.art] = wert;
    chef[1 - i].value = cent(100 - wert);
  }));
  form.addEventListener("input", zeigen);
  form.addEventListener("change", zeigen);
  zeigen();
}

// Kurztext wie „Flo 15 € bar · Lukas 30 € · Louis 15 €“
function aufteilungText(teil, betrag) {
  const teile = [
    ...teil.loehne.map((l) => `${esc(l.name)} ${euro(l.betrag)} bar`),
    ...PERSONEN.filter((p) => teil.konto[p] > 0 || betrag).map((p) => `${p} ${euro(teil.konto[p])}`),
  ];
  const text = teile.join(" · ");
  return teil.zuViel ? `${text} · <span class="minus">über 100 %!</span>` : text;
}

// Löhne eines Auftrags neu buchen: alte weg, neue rein (nie doppelt). Nur Mitarbeiter kriegen echten Lohn,
// Louis und Lukas bekommen ihren Teil aufs Konto. Beim Bezahlen werden die Prozente im Auftrag festgehalten.
async function lohnBuchen(neuA) {
  const a = { ...(daten.auftraege.find((x) => x.id === neuA.id) || {}), ...neuA };
  const alt = daten.auszahlungen.filter((x) => x.art === "lohn" && x.auftrag_id === a.id);
  for (const x of alt) await db.remove("auszahlungen", x.id);
  if (zahl(a.bekommen) !== null && a.id) {
    const fest = {};
    if (zahl(a.anteil_prozent) === null) fest.anteil_prozent = standardAnteil();
    if (zahl(a.allein_prozent) === null) fest.allein_prozent = alleinStandard();
    if (zahl(a.louis_prozent) === null) fest.louis_prozent = louisStandard();
    if (Object.keys(fest).length) {
      await db.update("auftraege", a.id, fest);
      Object.assign(a, fest);
      await laden("auftraege");
    }
  }
  if (zahl(a.bekommen) !== null && !istTermin(a)) {
    const { loehne } = kontoAufteilung(a);
    const kunde = kundeVon(a.kunde_id)?.name;
    for (const l of loehne) {
      if (!l.betrag) continue;
      await db.insert("auszahlungen", {
        an: l.name,
        betrag: l.betrag,
        art: "lohn",
        auftrag_id: a.id,
        datum: isoAusDatum(auftragDatum(a)),
        notiz: `Lohn ${a.leistung || "Auftrag"}${kunde ? ` bei ${kunde}` : ""}`,
      });
    }
  }
  await laden("auszahlungen");
}

// v25: geplante Dauer nach Auftragsgröße – von Hand > Stunden > 1,5 Min. pro Euro (ohne Anfahrt), mind. 1 Std., auf 15 Min. gerundet
// (gleiche Regel steht in supabase/quellen/gemeinsam.ts → planMinuten, für freie Website-Termine und Google-Kalender)
const MIN_PRO_EURO = 1.5;
function dauerSchaetzung(a) {
  const slot = Number(daten.einstellungen?.[0]?.slot_minuten) || 60;
  if (istTermin(a)) return Number(a.dauer_min) || slot;
  if (zahl(a.dauer_min)) return Number(a.dauer_min);
  if (zahl(a.stunden)) return Math.round(Number(a.stunden) * 60);
  const betrag = zahl(a.bekommen) ?? zahl(a.geschaetzt);
  if (betrag === null) return slot;
  const preis = Math.max(0, betrag - (zahl(a.anfahrt) || 0));
  return Math.max(60, Math.round((preis * MIN_PRO_EURO) / 15) * 15);
}

// Dauer eines Auftrags in Minuten: echt > geplant (dauerSchaetzung). geschaetzt = nicht echt eingetragen
function dauerVon(a) {
  if (zahl(a.dauer_echt_min)) return { min: Number(a.dauer_echt_min), geschaetzt: false };
  return { min: dauerSchaetzung(a), geschaetzt: true };
}

const stundenText = (min) => `${(Math.round((min / 60) * 10) / 10).toLocaleString("de-DE")} h`;

// Durchschnitte für den Zeitraum: pro Auftrag, pro Stunde, pro Fenster, Löhne
function kennzahlenFuer(von, bis) {
  const bezahlt = bezahltImZeitraum(von, bis).filter((a) => !istTermin(a));
  const umsatz = bezahlt.reduce((s, a) => s + Number(a.bekommen), 0);
  let minuten = 0;
  let personenMin = 0;
  let geschaetzt = 0;
  bezahlt.forEach((a) => {
    const d = dauerVon(a);
    minuten += d.min;
    personenMin += d.min * teamVon(a).length;
    if (d.geschaetzt) geschaetzt++;
  });
  const fensterAuftraege = bezahlt.filter((a) => Number(a.fenster_normal || 0) + Number(a.fenster_boden || 0) > 0);
  const fenster = fensterAuftraege.reduce((s, a) => s + Number(a.fenster_normal || 0) + Number(a.fenster_boden || 0), 0);
  const umsatzFenster = fensterAuftraege.reduce((s, a) => s + Number(a.bekommen), 0);
  const ids = new Set(bezahlt.map((a) => a.id));
  const lohnZeilen = daten.auszahlungen.filter((x) => x.art === "lohn" && ids.has(x.auftrag_id));
  const loehne = lohnZeilen.reduce((s, x) => s + Number(x.betrag), 0);
  const proPerson = {};
  lohnZeilen.forEach((x) => (proPerson[x.an] = (proPerson[x.an] || 0) + Number(x.betrag)));
  const stunden = minuten / 60;
  return {
    auftraege: bezahlt.length,
    umsatz,
    stunden,
    geschaetzt,
    proAuftrag: bezahlt.length ? umsatz / bezahlt.length : null,
    proStunde: stunden ? umsatz / stunden : null,
    // Stundenlohn pro Kopf: alles Geld ÷ (Stunden × Leute im Team)
    proStundePerson: personenMin ? umsatz / (personenMin / 60) : null,
    proFenster: fenster ? umsatzFenster / fenster : null,
    fensterProAuftrag: fensterAuftraege.length ? fenster / fensterAuftraege.length : null,
    loehne,
    proPerson,
    kasseProStunde: stunden ? (umsatz - loehne) / stunden : null,
  };
}

const euroOder = (w) => (w === null || w === undefined ? "–" : euro(Math.round(w * 100) / 100));

// Einsätze einer Person: bezahlte Aufträge, bei denen sie im Team war (Louis/Lukas ohne Team = dabei)
function einsaetzeVon(name, von = null, bis = null) {
  return daten.auftraege
    .filter((a) => !istTermin(a) && zahl(a.bekommen) !== null && teamVon(a).includes(name))
    .filter((a) => !von || imZeitraum(auftragDatum(a), von, bis))
    .sort((a, b) => auftragDatum(b) - auftragDatum(a));
}
const lohnFuer = (name, a) =>
  PERSONEN.includes(name) ? kontoAufteilung(a).konto[name] : daten.auszahlungen.filter((x) => x.art === "lohn" && x.auftrag_id === a.id && x.an === name).reduce((s, x) => s + Number(x.betrag), 0);

function personZahlen(name, von = null, bis = null) {
  const einsaetze = einsaetzeVon(name, von, bis);
  const lohn = einsaetze.reduce((s, a) => s + lohnFuer(name, a), 0);
  const minuten = einsaetze.reduce((s, a) => s + dauerVon(a).min, 0);
  return {
    einsaetze,
    lohn,
    minuten,
    umsatz: einsaetze.reduce((s, a) => s + Number(a.bekommen), 0),
    proStunde: minuten ? lohn / (minuten / 60) : null,
    proAuftrag: einsaetze.length ? lohn / einsaetze.length : null,
  };
}

// Eigene Konten: Die Kasse ist ein gemeinsamer Topf, darin hat jeder sein Guthaben.
// Guthaben = Anteile aus Aufträgen − halbe Ausgaben + selbst ausgelegt − ausgezahlt
function konten() {
  const k = Object.fromEntries(PERSONEN.map((name) => [name, { name, auftraege: 0, ausgaben: 0, ausgelegt: 0, ausgezahlt: 0 }]));
  daten.auftraege.filter((a) => zahl(a.bekommen) !== null).forEach((a) => {
    const t = kontoAufteilung(a);
    PERSONEN.forEach((p) => (k[p].auftraege += t.konto[p]));
  });
  daten.ausgaben.forEach((x) => {
    const b = Number(x.betrag) || 0;
    PERSONEN.forEach((p) => (k[p].ausgaben += b / 2));
    if (k[x.bezahlt_von]) k[x.bezahlt_von].ausgelegt += b;
  });
  daten.auszahlungen.filter((x) => x.art !== "lohn").forEach((x) => {
    const b = Number(x.betrag) || 0;
    if (k[x.an]) k[x.an].ausgezahlt += b;
    else PERSONEN.forEach((p) => (k[p].ausgezahlt += b / 2));
  });
  return PERSONEN.map((p) => {
    const z = k[p];
    return { ...z, guthaben: cent(z.auftraege - z.ausgaben + z.ausgelegt - z.ausgezahlt) };
  });
}
const guthabenVon = (name) => konten().find((p) => p.name === name)?.guthaben ?? 0;

const nochEintragen = () =>
  daten.auftraege
    .filter((a) => !istTermin(a) && !a.vorlaeufig && !a.abgesagt && zahl(a.bekommen) === null && a.datum && new Date(a.datum) < new Date())
    .sort((a, b) => new Date(a.datum) - new Date(b.datum));

const kommendeTermine = () =>
  daten.auftraege
    .filter((a) => !a.abgesagt && !a.vorlaeufig && a.datum && new Date(a.datum) >= new Date())
    .sort((a, b) => new Date(a.datum) - new Date(b.datum));

// Noch nicht fest: vorläufig ausgemacht oder ganz ohne Datum. Auch wenn der Tag vorbei ist, bleibt er hier stehen
const nochNichtFest = (a) => (a.vorlaeufig || !a.datum) && !a.abgesagt && zahl(a.bekommen) === null;
const geplanteTermine = () =>
  daten.auftraege
    .filter(nochNichtFest)
    .sort((a, b) => new Date(a.datum || a.erstellt) - new Date(b.datum || b.erstellt));

const anfragenTermine = () =>
  daten.auftraege
    .filter((a) => a.termin_status === "angefragt")
    .sort((a, b) => new Date(a.datum || a.erstellt) - new Date(b.datum || b.erstellt));

function veraenderung(jetzt, vorher, vergleich = "zum Vormonat") {
  if (!vorher) return "";
  const p = Math.round(((jetzt - vorher) / Math.abs(vorher)) * 100);
  return `<span class="${p >= 0 ? "plus" : "minus"}">${p >= 0 ? "+" : ""}${p} %</span> ${vergleich}`;
}

/* ===================== Bausteine ===================== */

const statusMarke = (id) => `<span class="status status--${esc(id)}">${esc(STATUS_NAME[id] || id)}</span>`;

// Icons wie in der Navigation; für Kartenköpfe und Bewegungen
const ICONS = {
  termin: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  aufgabe: '<path d="M4 6.5l2 2 3.5-4M4 16.5l2 2 3.5-4M13 7h7M13 17h7"/>',
  kunden: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-6 6.5-6s5.9 2.4 6.5 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .7 3.2 2.9 3.5 6"/>',
  geld: '<rect x="2.5" y="6" width="19" height="12.5" rx="3"/><circle cx="12" cy="12.25" r="2.75"/><path d="M6 9.5v5.5M18 9.5v5.5"/>',
  anfrage: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>',
  stift: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
  uhr: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  zahl: '<path d="M5 19V11m7 8V5m7 14v-6"/>',
  kontakt: '<path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5L17 13l4 1.5v3a2.5 2.5 0 0 1-2.7 2.5C10.9 19.5 4.5 13.1 4 5.7A2.5 2.5 0 0 1 6.5 3Z"/>',
  bewegung: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
  sperre: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 8 8 5 8-5"/>',
  haus: '<path d="M4 11.5 12 4.5l8 7"/><path d="M6 10v9.5h12V10"/><path d="M10 19.5v-5h4v5"/>',
  etikett: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.3 6.3a1.4 1.4 0 0 1-2 0Z"/><circle cx="8" cy="8" r="1.5"/>',
  megafon: '<path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1Z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5Z"/>',
};
const badge = (farbe, icon) => `<span class="badge badge--${farbe}" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[icon]}</svg></span>`;
const kartenTitel = (id, farbe, icon, titel) => `<h2 class="karte__titel" id="${id}">${badge(farbe, icon)}<span>${titel}</span></h2>`;

// Kontaktweg: feste Wege + eigene aus den Einstellungen (einstellungen.kanaele)
const KANAELE_FEST = {
  telefon: { name: "Telefon", farbe: "#2B5CFF", icon: "kontakt" },
  email: { name: "E-Mail", farbe: "#5B3FD6", icon: "mail" },
  website: { name: "Website", farbe: "#D08A00", icon: "web" },
  nebenan: { name: "nebenan.de", farbe: "#1E9E5A", icon: "haus" },
  kleinanzeigen: { name: "Kleinanzeigen", farbe: "#0F9A8A", icon: "etikett" },
};
const KANAELE = { ...KANAELE_FEST };
const KANAL_FARBEN = ["#E67C73", "#6A4BE0", "#E0457B", "#0FA3B1", "#F2B33D", "#151A2E"];
const eigeneKanaele = () => {
  const k = daten.einstellungen?.[0]?.kanaele;
  return Array.isArray(k) ? k : [];
};
// Entfernte eigene Kanäle bleiben bekannt (alte Aufträge), sind aber nicht mehr wählbar
function kanaeleLaden() {
  for (const id of Object.keys(KANAELE)) if (!KANAELE_FEST[id]) delete KANAELE[id];
  for (const e of eigeneKanaele()) KANAELE[e.id] = { name: e.name, farbe: e.farbe || "#6A4BE0", icon: "megafon", eigen: true, aus: !!e.aus };
}
const kanaeleWaehlbar = (gewaehlt = null) => {
  kanaeleLaden();
  return Object.entries(KANAELE).filter(([id, k]) => !k.aus || id === gewaehlt);
};
const kanalName = (kanal) => KANAELE[kanal]?.name || "";
const kanalMarke = (kanal) => {
  const k = KANAELE[kanal];
  if (!k) return "";
  return `<span class="kanal-marke kanal-marke--${kanal}" style="--kfarbe:${k.farbe}" role="img" title="${k.name}" aria-label="Kontakt über ${k.name}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k.icon]}</svg></span>`;
};

// Große Knöpfe für den Kontaktweg (Pflicht)
function kanalWahl(gewaehlt) {
  return `<fieldset class="kanal-wahl">
    <legend>Kontakt über</legend>
    <div class="kanal-wahl__reihe">
      ${kanaeleWaehlbar(gewaehlt).map(([id, k]) => `<label class="kanal-wahl__knopf" style="--c:${k.farbe}">
        <input type="radio" name="kanal" value="${id}"${gewaehlt === id ? " checked" : ""} />
        <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k.icon]}</svg>
        <span>${k.name}</span>
      </label>`).join("")}
    </div>
  </fieldset>`;
}

// Handy (bis 700 px): wird beim Drehen oder Verkleinern neu gezeichnet
const handyAnzeige = matchMedia("(max-width: 700px)");
const istHandy = () => handyAnzeige.matches;
handyAnzeige.addEventListener("change", () => render());

function kachel(titel, wert, info = "", dunkel = false, link = null, farbe = null) {
  const tag = link ? "a" : "div";
  const href = link ? ` href="${esc(link)}"` : "";
  const klassen = ["kachel", dunkel ? "kachel--dunkel" : "", farbe ? `kachel--${farbe}` : ""].filter(Boolean).join(" ");
  return `<${tag} class="${klassen}"${href}>
    <span class="kachel__titel">${titel}</span>
    <span class="kachel__wert">${wert}</span>
    ${info ? `<span class="kachel__info">${info}</span>` : ""}
  </${tag}>`;
}

function datumMarke(iso) {
  const d = new Date(iso);
  return `<span class="datum-marke"><b>${d.getDate()}</b><small>${esc(fmtMonatKurz.format(d))}</small></span>`;
}

// Ein Klick auf einen Termin öffnet die Terminkarte (Overlay), nicht direkt die Kundenseite
function terminZeile(a) {
  const k = kundeVon(a.kunde_id);
  const d = new Date(a.datum);
  return `<li><button class="zeile zeile--knopf${istTermin(a) ? " zeile--termin" : ""}" type="button" data-aktion="termin-karte" data-id="${esc(a.id)}">
    ${datumMarke(a.datum)}
    <span class="zeile__haupt">
      <span class="zeile__titel">${kanalMarke(a.kanal)}${esc(auftragName(a))}${istTermin(a) ? ` <span class="art-marke">${esc(auftragTitel(a))}</span>` : ""}</span>
      <span class="zeile__unter">${esc(fmtTag.format(d))}, ${esc(fmtUhr.format(d))} Uhr${istTermin(a) ? "" : ` · ${esc(a.leistung)}`}${k?.adresse ? ` · ${esc(k.adresse)}` : ""}</span>
    </span>
    ${zahl(a.geschaetzt) !== null ? `<span class="zeile__rechts leise">~${euro(a.geschaetzt)}</span>` : ""}
  </button></li>`;
}

// Vorläufiger Termin: festmachen oder anpassen
function geplantZeile(a) {
  const d = a.datum ? new Date(a.datum) : null;
  const vorbei = d && d < new Date();
  return `<li class="geplant-zeile">
    <button class="zeile zeile--knopf" type="button" data-aktion="termin-karte" data-id="${esc(a.id)}">
      ${d ? datumMarke(a.datum) : ""}
      <span class="zeile__haupt">
        <span class="zeile__titel">${kanalMarke(a.kanal)}${esc(auftragName(a))}${istTermin(a) ? ` <span class="art-marke">${esc(auftragTitel(a))}</span>` : ""}</span>
        <span class="zeile__unter">${d ? `wahrscheinlich ${esc(fmtTag.format(d))}, ${esc(fmtUhr.format(d))} Uhr` : '<span class="minus">Datum fehlt</span>'}${istTermin(a) ? "" : ` · ${esc(a.leistung)}`}${vorbei ? ' · <span class="minus">Tag ist vorbei</span>' : ""}</span>
      </span>
    </button>
    <div class="geplant-zeile__aktionen">
      ${d
        ? `<button class="knopf knopf--klein knopf--voll" type="button" data-aktion="termin-fix" data-id="${esc(a.id)}">Fix machen</button>`
        : `<button class="knopf knopf--klein knopf--voll" type="button" data-aktion="datum-festlegen" data-id="${esc(a.id)}">Datum festlegen</button>`}
      <button class="knopf knopf--klein knopf--leise" type="button" data-aktion="auftrag-bearbeiten" data-id="${esc(a.id)}">Ändern</button>
    </div>
  </li>`;
}

function eintragenZeile(a) {
  const k = kundeVon(a.kunde_id);
  return `<form class="eintragen" data-eintragen="${esc(a.id)}">
    <span class="zeile__haupt">
      <button class="zeile__titel zeile__titel--knopf" type="button" data-aktion="termin-karte" data-id="${esc(a.id)}">${kanalMarke(a.kanal)}${esc(k?.name || "Unbekannt")}</button>
      <span class="zeile__unter">${esc(fmtTag.format(new Date(a.datum)))} · ${esc(a.leistung)}${zahl(a.geschaetzt) !== null ? ` · geschätzt ${euro(a.geschaetzt)}` : ""}${a.team?.length ? ` · ${esc(a.team.join(", "))}` : ""}</span>
    </span>
    <label class="betrag">
      <span class="leise">Bekommen</span>
      <input class="eingabe zahl" name="bekommen" type="number" inputmode="decimal" min="0" step="0.5" required value="${esc(a.geschaetzt ?? "")}" aria-label="Wirklich bekommen in Euro" />
      <span>€</span>
    </label>
    <button class="knopf knopf--voll knopf--klein" type="submit">Speichern</button>
  </form>`;
}

function aufgabeZeile(a) {
  const k = a.kunde_id ? kundeVon(a.kunde_id) : null;
  const ueberfaellig = a.faellig && !a.erledigt && a.faellig < heuteIso();
  const unter = [
    k ? `<a class="aufgabe__kunde" href="#kunde/${esc(k.id)}">${esc(k.name)}</a>` : "",
    a.faellig ? `${ueberfaellig ? '<span class="minus">überfällig · </span>' : ""}${esc(fmtTag.format(new Date(`${a.faellig}T12:00`)))}${esc(aufgabeZeitText(a))}` : "",
  ].filter(Boolean).join(" · ");
  return `<li class="aufgabe${a.erledigt ? " erledigt" : ""}">
    <button class="haken" type="button" role="checkbox" aria-checked="${a.erledigt}" aria-label="${esc(a.titel)} erledigt" data-aktion="aufgabe-haken" data-id="${esc(a.id)}">
      <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>
    </button>
    <span class="zeile__haupt">
      <button class="zeile__titel" type="button" data-aktion="aufgabe-bearbeiten" data-id="${esc(a.id)}" style="all:unset;cursor:pointer;font-weight:650">${esc(a.titel)}</button>
      ${unter ? `<span class="zeile__unter">${unter}</span>` : ""}
    </span>
    ${personMarke(a.zustaendig)}
    ${a.erledigt ? "" : outpostKnopf(a)}
  </li>`;
}

const istIos = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function outpostLink(a) {
  const k = a.kunde_id ? kundeVon(a.kunde_id) : null;
  const p = new URLSearchParams({ titel: a.titel, liste: "Klar Glas" });
  if (a.faellig) p.set("faellig", a.faellig);
  if (k) p.set("notiz", [k.name, k.telefon, k.adresse].filter(Boolean).join(" · "));
  return `outpost://neu?${p.toString().replace(/\+/g, "%20")}`;
}

function outpostKnopf(a) {
  return istIos
    ? `<a class="knopf knopf--klein" href="${esc(outpostLink(a))}">In OutPost</a>`
    : `<button class="knopf knopf--klein" type="button" data-aktion="aufgabe-kopieren" data-id="${esc(a.id)}">Kopieren</button>`;
}

// Einfaches Balkendiagramm als SVG: Gruppen nebeneinander, Werte in Euro
function balken(gruppen, reihen, format = euro) {
  const wochen = gruppen[0]?.kw != null;
  const B = 640, H = 220, unten = wochen && gruppen.length <= 14 ? 38 : 28, oben = 16;
  const max = Math.max(1, ...gruppen.flatMap((g) => reihen.map((r) => Math.abs(g.werte[r.id] || 0))));
  const breiteGruppe = B / Math.max(gruppen.length, 1);
  const breiteBalken = Math.min(26, (breiteGruppe * 0.7) / reihen.length);
  const hoehe = (w) => ((H - unten - oben) * Math.max(0, w)) / max;
  let svg = `<svg class="diagramm" viewBox="0 0 ${B} ${H}" role="img" aria-label="${esc(gruppen.map((g) => `${g.label}: ${reihen.map((r) => `${r.name} ${format(g.werte[r.id] || 0)}`).join(", ")}`).join("; "))}">`;
  svg += `<line x1="0" x2="${B}" y1="${H - unten}" y2="${H - unten}" stroke="#E4E4E7" />`;
  const achse = wochen ? wochenAchse(gruppen, (i) => i * breiteGruppe + breiteGruppe / 2, breiteGruppe, { B, H, unten, oben }) : null;
  if (achse) svg += achse.hinten;
  gruppen.forEach((g, i) => {
    const text = `${g.titel || g.label}: ${reihen.map((r) => `${r.name} ${format(g.werte[r.id] || 0)}`).join(", ")}`;
    const spitze = Math.max(0, ...reihen.map((r) => hoehe(g.werte[r.id] || 0)));
    svg += `<rect class="diagramm__punkt" ${tippAttr(g, text)} data-x="${((i + 0.5) / gruppen.length).toFixed(4)}" data-y="${((H - unten - spitze) / H).toFixed(4)}" x="${(i * breiteGruppe).toFixed(1)}" y="0" width="${breiteGruppe.toFixed(1)}" height="${H}" fill="transparent" />`;
    const start = i * breiteGruppe + (breiteGruppe - breiteBalken * reihen.length - 4 * (reihen.length - 1)) / 2;
    reihen.forEach((r, j) => {
      const w = g.werte[r.id] || 0;
      const h = hoehe(w);
      const x = start + j * (breiteBalken + 4);
      svg += `<rect x="${x.toFixed(1)}" y="${(H - unten - h).toFixed(1)}" width="${breiteBalken.toFixed(1)}" height="${Math.max(h, w ? 2 : 0).toFixed(1)}" rx="5" fill="${r.farbe}" />`;
    });
    if (!wochen) svg += `<text x="${(i * breiteGruppe + breiteGruppe / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="13" fill="#5A6172" font-family="Figtree, sans-serif">${esc(g.label)}</text>`;
  });
  if (achse) svg += achse.vorne;
  return `${svg}</svg><p class="legende">${reihen.map((r) => `<span style="--farbe:${r.farbe}">${esc(r.name)}</span>`).join("")}</p>`;
}

// Antippbarer Punkt: Blase mit Wert, zweites Tippen öffnet die Aufträge dieses Zeitraums
function tippAttr(p, text) {
  const mitZeit = p.von instanceof Date && p.bis instanceof Date;
  const n = mitZeit ? bezahltImZeitraum(p.von, p.bis).length : null;
  const tipp = `${text}${n !== null ? ` · ${n} ${n === 1 ? "Auftrag" : "Aufträge"}` : ""}`;
  return `data-tipp="${esc(tipp)}"${mitZeit ? ` data-von="${p.von.toISOString()}" data-bis="${p.bis.toISOString()}" data-titel="${esc(p.titel || p.label)}"` : ""}`;
}

// Liniendiagramm als SVG für 12-Monats-Zeitreihen
function linie(punkte, opts = {}) {
  const { format = euro, mitProzent = false, treppe = false } = opts;
  if (!punkte || !punkte.length) return `<p class="leer">Noch keine Daten.</p>`;

  const wochen = punkte[0].kw != null;
  const B = 640, H = 220, unten = wochen && punkte.length <= 14 ? 38 : 28, oben = 16, seite = 40;
  const breite = B - 2 * seite;
  const hoehe_max = H - unten - oben;
  const min = Math.min(0, ...punkte.map((p) => p.wert));
  const max = Math.max(0, ...punkte.map((p) => p.wert));
  const spanne = max === min ? 1 : max - min;

  const yPos = (w) => oben + hoehe_max - ((w - min) / spanne) * hoehe_max;
  const xPos = (i) => seite + (i / Math.max(punkte.length - 1, 1)) * breite;

  let svg = `<svg class="diagramm" viewBox="0 0 ${B} ${H}" role="img" aria-label="Liniendiagramm">
    <defs>
      <linearGradient id="grad-linie" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style="stop-color:#2B5CFF;stop-opacity:0.15" />
        <stop offset="100%" style="stop-color:#2B5CFF;stop-opacity:0" />
      </linearGradient>
    </defs>
    <line x1="${seite}" x2="${B - seite}" y1="${H - unten}" y2="${H - unten}" stroke="#E4E4E7" />`;
  const achse = wochen ? wochenAchse(punkte, xPos, breite / Math.max(punkte.length - 1, 1), { B, H, unten, oben }) : null;
  if (achse) svg += achse.hinten;

  // Pfad für Bereich unter der Linie
  let pfad = `M ${xPos(0)} ${H - unten}`;
  const schritt = (i) => (treppe && i > 0 ? ` L ${xPos(i)} ${yPos(punkte[i - 1].wert)}` : "");
  punkte.forEach((p, i) => {
    pfad += `${schritt(i)} L ${xPos(i)} ${yPos(p.wert)}`;
  });
  pfad += ` L ${xPos(punkte.length - 1)} ${H - unten} Z`;
  svg += `<path d="${pfad}" fill="url(#grad-linie)" />`;

  // Linie selbst
  let linie_pfad = `M ${xPos(0)} ${yPos(punkte[0].wert)}`;
  punkte.slice(1).forEach((p, i) => {
    linie_pfad += `${schritt(i + 1)} L ${xPos(i + 1)} ${yPos(p.wert)}`;
  });
  svg += `<path d="${linie_pfad}" stroke="#2B5CFF" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;

  // Punkte und Labels
  punkte.forEach((p, i) => {
    const x = xPos(i);
    const y = yPos(p.wert);
    const text = `${p.titel || p.label}: ${format(p.wert)}${p.quote != null ? ` · Ø ${p.quote} %` : ""}`;
    svg += `<g class="diagramm__punkt" ${tippAttr(p, text)} data-x="${(x / B).toFixed(4)}" data-y="${(y / H).toFixed(4)}"><circle cx="${x}" cy="${y}" r="16" fill="transparent" /><circle class="diagramm__kreis" cx="${x}" cy="${y}" r="3.5" fill="#2B5CFF" />
      <title>${esc(text)}</title></g>`;
    if (wochen || (i % Math.ceil(punkte.length / 12) && i !== punkte.length - 1)) return;
    svg += `<text x="${x}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#5A6172" font-family="Figtree, sans-serif">${esc(p.label)}</text>`;
  });

  // Wert über dem letzten Punkt
  const letzter = punkte[punkte.length - 1];
  const labelLetzt = mitProzent && letzter.quote != null ? `${format(letzter.wert)} · Ø ${letzter.quote} %` : format(letzter.wert);
  if (achse) svg += achse.vorne;
  svg += `<text x="${xPos(punkte.length - 1) + 4}" y="${Math.max(yPos(letzter.wert) - 12, 12)}" text-anchor="end" font-size="12" font-weight="700" fill="#010F2B" font-family="Figtree, sans-serif">${esc(labelLetzt)}</text>`;

  return svg + `</svg>`;
}

function bewegungenListe(seitDatum = null) {
  const bewegungen = [
    ...daten.auftraege.filter((a) => zahl(a.bekommen) !== null && (!seitDatum || auftragDatum(a) >= seitDatum)).map((a) => ({
      art: "rein", datum: auftragDatum(a), betrag: Number(a.bekommen),
      titel: kundeVon(a.kunde_id)?.name || "Auftrag", unter: a.leistung, link: `#kunde/${a.kunde_id}`,
    })),
    ...daten.ausgaben.filter((x) => !seitDatum || new Date(x.datum) >= seitDatum).map((x) => ({
      art: "aus", datum: new Date(x.datum), betrag: -Number(x.betrag), titel: x.kategorie, kasse: x.bezahlt_von === "Kasse",
      unter: `${x.notiz ? `${x.notiz} · ` : ""}${x.bezahlt_von === "Kasse" ? "aus der Kasse" : `ausgelegt von ${x.bezahlt_von}${x.erstattet ? ", erstattet" : ""}`}`,
      aktion: "ausgabe-bearbeiten", id: x.id,
    })),
    ...daten.auszahlungen.filter((x) => !seitDatum || new Date(x.datum) >= seitDatum).map((x) =>
      x.art === "lohn"
        ? { art: "lohn", datum: new Date(x.datum), betrag: -Number(x.betrag), titel: `Lohn an ${x.an}`, unter: x.notiz || "", link: `#mitarbeiter/${encodeURIComponent(x.an)}` }
        : { art: "auszahlung", datum: new Date(x.datum), betrag: -Number(x.betrag), titel: `Auszahlung an ${x.an}`, unter: x.notiz || "", aktion: "auszahlung-bearbeiten", id: x.id }
    ),
  ].sort((a, b) => b.datum - a.datum);

  return bewegungen;
}

function kassenstandVerlauf() {
  // Von Louis/Lukas ausgelegte Ausgaben ändern die Kasse erst, wenn sie erstattet werden (= Auszahlung)
  const bewegungen = bewegungenListe().filter((b) => b.art !== "aus" || b.kasse);
  let stand = 0;
  const verlauf = [];
  [...bewegungen].reverse().forEach((b) => {
    stand += b.betrag;
    verlauf.push({ stand, datum: b.datum, bewegung: b });
  });
  return verlauf;
}

/* ===================== Ansichten ===================== */

function ansichtUebersicht() {
  const monat = zeitraumGrenzen("monat", new Date());
  const m = zahlenFuer(monat.von, monat.bis);
  const v = zahlenFuer(monat.vorVon, monat.vorBis);
  const offen = nochEintragen();
  const anfragen = anfragenTermine();
  const geplant = geplanteTermine();
  const handy = istHandy();
  const termine = kommendeTermine().slice(0, handy ? 5 : 4);
  const aufgaben = sichtbareAufgaben().filter((a) => !a.erledigt).sort(nachFaelligkeit).slice(0, 5);
  const zaehlung = STATUS.map((s) => ({ ...s, anzahl: daten.kunden.filter((k) => k.status === s.id).length }));
  const gesamt = daten.kunden.length;
  const tgQuote = trinkgeldQuote(bezahltImZeitraum(monat.von, monat.bis));

  return `
    <div class="kopfzeile">
      <div>
        <h1>Hallo ${esc(ich)}</h1>
        <p class="leise">${esc(fmtTagLang.format(new Date()))}</p>
      </div>
      <div class="knopfreihe" ${handy ? "hidden" : ""}>
        <button class="knopf" type="button" data-aktion="kunde-neu">Kunde anlegen</button>
        <button class="knopf" type="button" data-aktion="termin-neu">Termin anlegen</button>
        <button class="knopf knopf--voll" type="button" data-aktion="auftrag-neu">Auftrag anlegen</button>
      </div>
    </div>

    ${handy ? `<div class="knopfreihe knopfreihe--gross">
      <button class="knopf knopf--gross" type="button" data-aktion="kunde-neu">+ Kunde</button>
      <button class="knopf knopf--gross" type="button" data-aktion="termin-neu">+ Termin</button>
      <button class="knopf knopf--voll knopf--gross" type="button" data-aktion="auftrag-neu">+ Auftrag</button>
    </div>` : ""}

    <section class="raster raster--kacheln" ${handy ? "hidden" : ""} aria-label="Zahlen diesen Monat">
      ${kachel(`Umsatz ${esc(fmtMonat.format(new Date()).split(" ")[0])}`, euro(m.umsatz), veraenderung(m.umsatz, v.umsatz) || `${m.auftraege} ${m.auftraege === 1 ? "Auftrag" : "Aufträge"}`, false, "#geld?zeige=umsatz", "blau")}
      ${kachel("Gewinn", euro(m.gewinn), `Ausgaben ${euro(m.ausgaben)}`, false, "#geld?zeige=gewinn", "gruen")}
      ${kachel("Marge", m.marge === null ? "–" : `${m.marge} %`, "Gewinn vom Umsatz", false, "#geld?zeige=marge", "violett")}
      ${kachel("Trinkgeld", euro(m.trinkgeld), tgQuote !== null ? `Ø ${tgQuote} % Trinkgeld` : "diesen Monat", false, "#geld?zeige=trinkgeld", "bernstein")}
      ${(() => { const nk = neukundenIm(zeitraumGrenzen("monat", new Date()).von, zeitraumGrenzen("monat", new Date()).bis); return kachel("Neukunden", `${nk.neu} neu`, `davon ${nk.mit} mit Auftrag`, false, "#geld?zeige=neukunden", "himmel"); })()}
      ${kachel("Kassenstand", euro(kassenstand()), "so viel Bargeld sollte da sein", true, "#geld?zeige=kasse", "kasse")}
    </section>

    ${anfragen.length ? `<section class="karte karte--terminanfrage" aria-labelledby="t-anfragen">
      <div class="karte__kopf">${kartenTitel("t-anfragen", "weiss", "anfrage", "Terminanfragen")}<span class="leise">${anfragen.length} offen</span></div>
      <ul class="liste">${anfragen.map((a) => {
        const k = kundeVon(a.kunde_id);
        const d = new Date(a.datum);
        const fensterInfo = a.fenster_normal || a.fenster_boden ? ` · ${Number(a.fenster_normal || 0)} + ${Number(a.fenster_boden || 0)} bt.` : "";
        return `<li class="terminanfrage">
          <button class="zeile zeile--knopf terminanfrage__eintrag" type="button" data-aktion="termin-karte" data-id="${esc(a.id)}">
            <span class="zeile__haupt">
              <span class="zeile__titel">${kanalMarke(a.kanal)}${esc(k?.name || "Unbekannt")}</span>
              <span class="zeile__unter">${esc(fmtTagLang.format(d))} · ${esc(fmtUhr.format(d))} Uhr</span>
              <span class="zeile__unter"><small>${esc(a.leistung)}${fensterInfo}${zahl(a.geschaetzt) !== null ? ` · ca. ${euro(a.geschaetzt)}` : ""}${k?.adresse ? ` · ${esc(k.adresse)}` : ""}</small></span>
            </span>
          </button>
          <div class="terminanfrage__aktionen">
            <button class="knopf knopf--klein" type="button" data-aktion="termin-bestaetigen" data-id="${esc(a.id)}">Bestätigen</button>
            <button class="knopf knopf--klein knopf--leise" type="button" data-aktion="termin-verschieben" data-id="${esc(a.id)}">Anderer Termin</button>
            <button class="knopf knopf--klein knopf--leise" type="button" data-aktion="termin-ablehnen" data-id="${esc(a.id)}">Ablehnen</button>
          </div>
        </li>`;
      }).join("")}</ul>
    </section>` : ""}

    ${geplant.length ? `<section class="karte karte--geplant" aria-labelledby="t-geplant">
      <div class="karte__kopf">${kartenTitel("t-geplant", "tuerkis", "uhr", "Geplant, noch nicht fest")}<span class="leise">${geplant.length} vorläufig</span></div>
      <ul class="liste">${geplant.map(geplantZeile).join("")}</ul>
    </section>` : ""}

    ${offen.length ? `<section class="karte karte--bernstein" aria-labelledby="t-eintragen">
      <div class="karte__kopf">${kartenTitel("t-eintragen", "bernstein", "stift", "Noch eintragen")}<span class="leise">${offen.length} Termin${offen.length === 1 ? "" : "e"}</span></div>
      <p class="hinweis">Wie viel habt ihr wirklich bekommen? Trinkgeld einfach mitzählen.</p>
      <div>${offen.map(eintragenZeile).join("")}</div>
    </section>` : ""}

    <div class="raster raster--zwei">
      <section class="karte" aria-labelledby="t-termine">
        <div class="karte__kopf">${kartenTitel("t-termine", "blau", "termin", "Nächste Termine")}<div class="knopfreihe"><button class="knopf knopf--klein" type="button" data-aktion="termin-neu">+ Termin</button><a class="knopf knopf--klein knopf--leise" href="#kalender">Kalender</a></div></div>
        ${termine.length ? `<ul class="liste">${termine.map(terminZeile).join("")}</ul>` : `<p class="leer">Gerade keine Termine. Zeit für Werbung im Märchenviertel.</p>`}
      </section>

      <section class="karte" ${handy ? "hidden" : ""} aria-labelledby="t-aufgaben">
        <div class="karte__kopf">${kartenTitel("t-aufgaben", "violett", "aufgabe", "Offene Aufgaben")}<button class="knopf knopf--klein" type="button" data-aktion="aufgabe-neu">Neu</button></div>
        ${aufgaben.length ? `<ul class="liste">${aufgaben.map(aufgabeZeile).join("")}</ul>` : `<p class="leer">Alles erledigt.</p>`}
      </section>
    </div>

    ${handy ? `<section class="raster" aria-label="Zahlen">
      ${kachel("Kassenstand", euro(kassenstand()), "so viel Bargeld sollte da sein", true, "#geld?zeige=kasse", "kasse")}
      ${kachel(`Umsatz ${esc(fmtMonat.format(new Date()).split(" ")[0])}`, euro(m.umsatz), veraenderung(m.umsatz, v.umsatz) || `${m.auftraege} ${m.auftraege === 1 ? "Auftrag" : "Aufträge"}`, false, "#geld?zeige=umsatz", "blau")}
    </section>` : ""}

    <section class="karte" ${handy ? "hidden" : ""} aria-labelledby="t-stand">
      <div class="karte__kopf">${kartenTitel("t-stand", "himmel", "kunden", "Kunden nach Stand")}<a class="knopf knopf--klein knopf--leise" href="#kunden">Alle ${gesamt}</a></div>
      ${gesamt ? `<div class="stand" aria-hidden="true">${zaehlung.filter((s) => s.anzahl).map((s) => `<span style="flex:${s.anzahl};background:${s.farbe}"></span>`).join("")}</div>` : ""}
      <div class="chips">${zaehlung.map((s) => {
        const hell = { neu: "rgba(43, 92, 255, 0.08)", kontakt: "#f0ebff", geplant: "#fbe9e7", termin: "#fff4e0", erledigt: "#e6f5ee", stamm: "#e8eaf0", funkstille: "#eef0f3", abgesagt: "#f4f5f7" }[s.id];
        return `<a class="chip chip--legende" href="#kunden?status=${s.id}" style="--chip-bg:${hell};--chip-farbe:${s.farbe}"><span class="chip__punkt"></span>${esc(s.name)}<span class="chip__zahl">${s.anzahl}</span></a>`;
      }).join("")}</div>
    </section>
    ${handy ? "" : kanalAuswertung()}`;
}

// Dezent (nur Desktop): über welchen Kontaktweg alle Kunden zu uns kommen, als Ring-Diagramm
const OHNE_KANAL = { name: "Ohne Angabe", farbe: "#9AA3B2", icon: "kontakt" };
function kanalAuswertung() {
  const zaehl = Object.fromEntries([...Object.keys(KANAELE), "ohne"].map((id) => [id, 0]));
  daten.kunden.forEach((k) => {
    const kanal = kanalVonKunde(k);
    zaehl[kanal in KANAELE ? kanal : "ohne"] += 1;
  });
  const gesamt = Object.values(zaehl).reduce((s, n) => s + n, 0);
  const arten = Object.entries(KANAELE).filter(([id, k]) => !k.aus || zaehl[id]).concat(zaehl.ohne ? [["ohne", OHNE_KANAL]] : []);
  const teile = arten.map(([id, k]) => ({
    id,
    name: k.name,
    farbe: k.farbe,
    icon: k.icon,
    n: zaehl[id],
    p: gesamt ? Math.round((zaehl[id] / gesamt) * 100) : 0,
  }));

  // Ring: r = 46 im 120er-Raster, Lücke zwischen den Segmenten in Pixeln der Kreislinie
  const R = 46;
  const U = 2 * Math.PI * R;
  const LUECKE = gesamt ? 4 : 0;
  let vorher = 0;
  const segmente = teile
    .filter((t) => t.n)
    .map((t) => {
      const laenge = (t.n / gesamt) * U;
      const strich = Math.max(0, laenge - LUECKE);
      const start = vorher + LUECKE / 2;
      vorher += laenge;
      return `<circle class="kanal-donut__teil" cx="60" cy="60" r="${R}" stroke="${t.farbe}" stroke-dasharray="${strich.toFixed(2)} ${(U - strich).toFixed(2)}" stroke-dashoffset="${(-start).toFixed(2)}" />`;
    })
    .join("");
  const beschriftung = gesamt
    ? teile.map((t) => `${t.name} ${t.n} (${t.p} %)`).join(", ")
    : "Noch keine Kunden";

  const legende = teile
    .map((t) => `<li class="kanal-legende__zeile">
      <span class="kanal-marke kanal-marke--${t.id}" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[t.icon]}</svg></span>
      <span class="kanal-legende__name">${esc(t.name)}</span>
      <span class="kanal-legende__anzahl">${t.n}</span>
      <span class="kanal-legende__prozent">${t.p} %</span>
    </li>`)
    .join("");

  return `<section class="karte kanal-karte" aria-labelledby="t-kanal">
    ${kartenTitel("t-kanal", "himmel", "kontakt", "So erreichen uns Kunden")}
    <div class="kanal-karte__inhalt">
      <div class="kanal-donut" role="img" aria-label="${esc(beschriftung)}">
        <svg class="kanal-donut__svg" viewBox="0 0 120 120" aria-hidden="true">
          <g transform="rotate(-90 60 60)">
            <circle class="kanal-donut__spur" cx="60" cy="60" r="${R}" />
            ${segmente}
          </g>
        </svg>
        <div class="kanal-donut__mitte" aria-hidden="true">
          <b>${gesamt || "–"}</b>
          <span>Kunden</span>
        </div>
      </div>
      <div class="kanal-karte__rechts">
        ${gesamt
          ? `<ul class="kanal-legende">${legende}</ul>
             <p class="hinweis">Grundlage: ${gesamt} ${gesamt === 1 ? "Auftrag" : "Aufträge"} mit Angabe zum Kontaktweg.</p>`
          : `<p class="kanal-leer">Noch keine Aufträge mit Kontaktweg. Sobald der erste eingetragen ist, siehst du hier, wie die Leute zu euch finden.</p>`}
      </div>
    </div>
  </section>`;
}

function nachFaelligkeit(a, b) {
  const x = `${a.faellig || "9999"} ${a.uhrzeit || "99"}`;
  const y = `${b.faellig || "9999"} ${b.uhrzeit || "99"}`;
  return x < y ? -1 : x > y ? 1 : 0;
}

// Offene Aufgaben in Abschnitte: heute fällig (inkl. überfällig), bald (nächste 7 Tage), später / ohne Tag
function aufgabenAbschnitte(liste) {
  const heute = heuteIso();
  const bald = isoAusDatum(tagPlus(new Date(), 7));
  return [
    ["Heute fällig", liste.filter((a) => a.faellig && a.faellig <= heute)],
    ["Bald", liste.filter((a) => a.faellig && a.faellig > heute && a.faellig <= bald)],
    ["Später", liste.filter((a) => !a.faellig || a.faellig > bald)],
  ].filter(([, l]) => l.length);
}
const aufgabeZeitText = (a) => `${a.uhrzeit ? ` · ${a.uhrzeit.slice(0, 5)} Uhr` : ""}${a.push ? ` · 🔔${a.vorlauf_min ? ` ${vorlaufText(a.vorlauf_min)}` : ""}` : ""}`;

function naechsterTermin(kundeId) {
  return kommendeTermine().find((a) => a.kunde_id === kundeId);
}

// Kunden-Seite, Ansicht „Aufträge“: alle vergangenen Aufträge, neueste zuerst
function auftraegeListe() {
  const q = zustand.suche.trim().toLowerCase();
  const z = zustand.auftraegeZeitraum;
  const jetzt = new Date();
  return daten.auftraege
    .filter((a) => !istTermin(a) && !a.abgesagt && (zahl(a.bekommen) !== null || (a.datum && !a.vorlaeufig && new Date(a.datum) < jetzt)))
    .filter((a) => !z || (auftragDatum(a) >= z.von && auftragDatum(a) < z.bis))
    .filter((a) => {
      if (!q) return true;
      const k = kundeVon(a.kunde_id) || {};
      return [k.name, k.adresse, k.telefon, a.leistung, a.notiz].some((x) => (x || "").toLowerCase().includes(q));
    })
    .sort((a, b) => auftragDatum(b) - auftragDatum(a));
}

const auftragBetragText = (a) => (zahl(a.bekommen) !== null ? euro(a.bekommen) : zahl(a.geschaetzt) !== null ? `~${euro(a.geschaetzt)}` : "offen");

function kundenUmschalter() {
  const i = zustand.kundenAnsicht === "auftraege" ? 1 : 0;
  return `<div class="segment segment--zwei kunden-umschalter" role="group" aria-label="Ansicht wählen">
    <span class="segment__pille" aria-hidden="true" data-ziel="${i}" style="--i:${i}"></span>
    <button class="segment__knopf" type="button" aria-pressed="${i === 0}" data-aktion="kunden-ansicht" data-wert="kunden">Kunden</button>
    <button class="segment__knopf" type="button" aria-pressed="${i === 1}" data-aktion="kunden-ansicht" data-wert="auftraege">Aufträge</button>
  </div>`;
}

function zeitraumFilterText() {
  const z = zustand.auftraegeZeitraum;
  return z ? `<p class="zeitraum-filter">Nur ${esc(z.titel)} <button class="knopf knopf--klein knopf--leise" type="button" data-aktion="auftraege-zeitraum-weg">Alle zeigen</button></p>` : "";
}

function ansichtAuftraegeListe() {
  const liste = auftraegeListe();
  const summe = liste.reduce((s, a) => s + (zahl(a.bekommen) || 0), 0);
  return `
    <div class="kopfzeile">
      <div><h1>Aufträge</h1><p class="leise">${liste.length} ${liste.length === 1 ? "Auftrag" : "Aufträge"}${summe ? ` · ${euro(summe)} bekommen` : ""}</p></div>
      ${kundenUmschalter()}
    </div>
    <label class="feld">
      <span class="visually-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">Aufträge suchen</span>
      <input class="eingabe" id="suche" type="search" placeholder="Name, Straße oder Leistung suchen" value="${esc(zustand.suche)}" data-suche autocomplete="off" />
    </label>
    ${zeitraumFilterText()}
    <section class="karte">
      ${liste.length ? `<ul class="liste">${liste.map((a) => {
        const k = kundeVon(a.kunde_id);
        const d = auftragDatum(a);
        return `<li><button class="zeile zeile--knopf" type="button" data-aktion="termin-karte" data-id="${esc(a.id)}">
          ${datumMarke(d.toISOString())}
          <span class="zeile__haupt">
            <span class="zeile__titel">${kanalMarke(a.kanal)}${esc(auftragName(a))}</span>
            <span class="zeile__unter">${esc(fmtDatum.format(d))} · ${esc(a.leistung || "")}${a.team?.length ? ` · ${esc(teamVon(a).join(", "))}` : ""}${k?.adresse ? ` · ${esc(k.adresse)}` : ""}</span>
          </span>
          <span class="zeile__rechts${zahl(a.bekommen) === null ? " minus" : ""}">${auftragBetragText(a)}</span>
        </button></li>`;
      }).join("")}</ul>` : `<p class="leer">${zustand.suche || zustand.auftraegeZeitraum ? "Nichts gefunden." : "Noch keine vergangenen Aufträge."}</p>`}
    </section>`;
}

function ansichtKunden() {
  if (zustand.kundenAnsicht === "auftraege") return ansichtAuftraegeListe();
  const q = zustand.suche.trim().toLowerCase();
  const passt = (k) => !q || [k.name, k.adresse, k.telefon, k.email].some((f) => (f || "").toLowerCase().includes(q));
  const gesucht = daten.kunden.filter(passt);
  const gefiltert = gesucht.filter((k) => zustand.kundenFilter === "alle" || k.status === zustand.kundenFilter);
  const sortiert = [...gefiltert].sort((a, b) => new Date(b.erstellt) - new Date(a.erstellt));

  const karte = (k) => {
    const t = naechsterTermin(k.id);
    const erledigt = auftraegeVon(k.id).filter((a) => zahl(a.bekommen) !== null);
    const tgQuote = trinkgeldQuote(erledigt);
    return `<a class="kanban__karte" href="#kunde/${esc(k.id)}" draggable="true" data-kunde="${esc(k.id)}">
      <b>${esc(k.name)}</b>
      <span>${t ? `${esc(fmtTag.format(new Date(t.datum)))}, ${esc(fmtUhr.format(new Date(t.datum)))}` : esc(k.adresse || k.telefon || "–")}</span>
      ${tgQuote !== null ? `<small style="opacity:0.6;font-size:0.7rem">Ø ${tgQuote} % TG</small>` : ""}
    </a>`;
  };

  return `
    <div class="kopfzeile">
      <div><h1>Kunden</h1><p class="leise">${daten.kunden.length} insgesamt</p></div>
      ${kundenUmschalter()}
      <button class="knopf knopf--voll${istHandy() ? " knopf--gross" : ""}" type="button" data-aktion="kunde-neu">${istHandy() ? "+ Kunde" : "Kunde anlegen"}</button>
    </div>
    <label class="feld">
      <span class="visually-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">Kunden suchen</span>
      <input class="eingabe" id="suche" type="search" placeholder="Name, Straße oder Telefon suchen" value="${esc(zustand.suche)}" data-suche autocomplete="off" />
    </label>

    <div class="kundenliste-handy">
      <div class="chips" role="group" aria-label="Nach Status filtern">
        <button class="chip" type="button" aria-pressed="${zustand.kundenFilter === "alle"}" data-aktion="filter" data-wert="alle">Alle<span class="chip__zahl">${gesucht.length}</span></button>
        ${STATUS.map((s) => `<button class="chip" type="button" aria-pressed="${zustand.kundenFilter === s.id}" data-aktion="filter" data-wert="${s.id}">${esc(s.name)}<span class="chip__zahl">${gesucht.filter((k) => k.status === s.id).length}</span></button>`).join("")}
      </div>
      <section class="karte" style="margin-top:1rem">
        ${sortiert.length ? `<ul class="liste">${sortiert.map((k) => {
          const t = naechsterTermin(k.id);
          const erledigt = auftraegeVon(k.id).filter((a) => zahl(a.bekommen) !== null);
          const tgQuote = trinkgeldQuote(erledigt);
          return `<li><a class="zeile" href="#kunde/${esc(k.id)}">
            <span class="zeile__haupt">
              <span class="zeile__titel">${esc(k.name)}</span>
              <span class="zeile__unter">${t ? `Termin ${esc(fmtTag.format(new Date(t.datum)))} · ` : ""}${esc(k.adresse || k.telefon || "")}${tgQuote !== null ? ` · Ø ${tgQuote} % TG` : ""}</span>
            </span>
            ${istHandy() ? `<span class="statuspunkt" style="--farbe:${STATUS.find((s) => s.id === k.status)?.farbe || "#B5B9C3"}" role="img" title="${esc(STATUS_NAME[k.status] || "")}" aria-label="${esc(STATUS_NAME[k.status] || "")}"></span>` : statusMarke(k.status)}
          </a></li>`;
        }).join("")}</ul>` : `<p class="leer">${daten.kunden.length ? "Niemand gefunden." : "Noch keine Kunden. Neue Anfragen von der Website landen automatisch hier."}</p>`}
      </section>
    </div>

    <div class="kanban" aria-label="Kunden nach Status, Karten lassen sich verschieben">
      ${STATUS.map((s) => {
        const liste = gesucht.filter((k) => k.status === s.id).sort((a, b) => new Date(b.erstellt) - new Date(a.erstellt));
        return `<section class="kanban__spalte" data-spalte="${s.id}">
          <div class="kanban__kopf"><span style="color:${s.farbe}">● </span><span style="flex:1">${esc(s.name)}</span><span class="leise">${liste.length}</span></div>
          ${liste.map(karte).join("")}
        </section>`;
      }).join("")}
    </div>`;
}

// nebenan.de: Link aus der App oder nur der Profilpfad – beides wird zu einer vollständigen Adresse
const nebenanUrl = (link) => (/^https?:\/\//i.test(link) ? link : `https://nebenan.de/${String(link).replace(/^\/+/, "")}`);

// Ein Eintrag im Verlauf; lange Nachrichten (z. B. reinkopierte Mails) sind eingeklappt
// v25: Website-Anfrage-Notiz („Anfrage über die Website, Wunschtermin …: „…“") in ihre Teile zerlegen
const WERBE_KANAL = { email: "E-Mail", whatsapp: "WhatsApp" };
const werbeKanaele = (liste) => (liste || []).filter(Boolean).map((k) => WERBE_KANAL[k] || k).join(", ");
function anfrageTeile(text) {
  text = String(text || "");
  if (!text.startsWith("Anfrage über die Website")) return null;
  const tz = text.indexOf(": „");
  const kopf = tz >= 0 ? text.slice(0, tz) : text;
  let rumpf = tz >= 0 ? text.slice(tz + 3).replace(/“\s*$/, "") : "";
  const t = { wunsch: (kopf.match(/Wunschtermin (\d\d\.\d\d\. \d\d:\d\d)/) || [])[1] || "", fenster: (kopf.match(/· (.+ Fenster)/) || [])[1] || "" };
  const [vorWerbung, werbung = ""] = rumpf.split("--- Freiwilliger Werbe-Anmeldewunsch ---");
  const [nachricht, anfahrtTeil = ""] = vorWerbung.split("--- Anfahrt und Gesamtschätzung ---");
  t.nachricht = nachricht.trim();
  const anf = anfahrtTeil.match(/([\d.,]+)\s*€ zusätzlich, einmal pro Auftrag · ([\d.,]+) km Luftlinie/);
  if (anf) { t.anfahrt = `${anf[1].replace(/,00$/, "")} €`; t.km = `${anf[2]} km Luftlinie`; }
  else if (/Noch offen/.test(anfahrtTeil)) t.anfahrt = "noch offen";
  const ges = anfahrtTeil.match(/Ca\. ([\d.,]+) € inklusive/);
  if (ges) t.gesamt = `ca. ${ges[1]} €${anf ? " inkl. Anfahrt" : ""}`;
  else if (/Leistung nach Absprache/.test(anfahrtTeil)) t.gesamt = "nach Absprache";
  const kan = werbung.match(/Gewählte Kanäle: (.*)/);
  t.werbung = kan ? `${werbeKanaele(kan[1].split(/,\s*/))} · noch nicht bestätigt` : "";
  // Alles Übrige (Tarif, Wortlaut, Zeitpunkte …) für „Sonstiges“
  t.rest = [anfahrtTeil.split("\n").filter((z) => z.trim() && !/zusätzlich, einmal pro Auftrag|^Ca\. |Noch offen|Leistung nach Absprache/.test(z)).join("\n"), werbung.trim()].filter(Boolean).join("\n\n").trim();
  return t;
}

function anfrageHtml(t) {
  const reihe = (titel, wert) => (wert ? `<div><dt>${titel}</dt><dd>${esc(wert)}</dd></div>` : "");
  return `<span class="anfrage-info__titel">Anfrage über die Website</span>
    <dl class="anfrage-info">
      ${reihe("Wunschtermin", t.wunsch)}
      ${reihe("Fenster", t.fenster)}
      ${reihe("Geschätzt", t.gesamt)}
      ${reihe("Anfahrt", [t.anfahrt, t.km].filter(Boolean).join(" · "))}
      ${reihe("Nachricht", t.nachricht ? `„${t.nachricht}“` : "")}
      ${reihe("Werbung", t.werbung || (t.rest || t.anfahrt ? "nein" : ""))}
    </dl>
    ${t.rest ? `<details class="anfrage-info__rest"><summary>Sonstiges</summary><p>${esc(t.rest)}</p></details>` : ""}`;
}

// Notiztext als HTML: Website-Anfragen geordnet, alles andere wie geschrieben
// v25: Werbe-Wunsch von der Website (Spalte kunden.werbung)
function werbungText(k) {
  const w = k?.werbung;
  if (!w || !w.kanaele?.length) return "";
  const wann = w.zeitpunkt && !isNaN(new Date(w.zeitpunkt)) ? ` am ${fmtDatum.format(new Date(w.zeitpunkt))}` : "";
  return `${werbeKanaele(w.kanaele)} angeklickt${wann} · ${w.status === "bestaetigt" ? "bestätigt" : "noch nicht bestätigt"}`;
}

const notizTextHtml = (text) => { const t = anfrageTeile(text); return t ? anfrageHtml(t) : esc(text); };

function verlaufEintrag(n) {
  const quelle = n.quelle && n.quelle !== "notiz" ? NACHRICHT_QUELLEN[n.quelle] : "";
  const text = String(n.text || "");
  const anfrage = anfrageTeile(text);
  const lang = text.length > 280 || text.split("\n").length > 5;
  const inhaltText = anfrage ? `<div class="anfrage-info__box">${anfrageHtml(anfrage)}</div>` : lang
    ? `<details class="verlauf__lang"><summary>${esc(text.slice(0, 160).replace(/\s+/g, " "))} …</summary><p>${esc(text)}</p></details>`
    : `<span>${esc(text)}</span>`;
  return `<li class="${n.automatisch ? "auto" : ""}${quelle ? " verlauf--nachricht" : ""}">
    ${quelle ? `<span class="verlauf__quelle">${esc(quelle)}</span>` : ""}
    ${inhaltText}
    <small>${esc(fmtDatum.format(new Date(n.erstellt)))}, ${esc(fmtUhr.format(new Date(n.erstellt)))} · ${esc(n.autor || "")}</small>
  </li>`;
}

function ansichtKunde(id) {
  const k = kundeVon(id);
  if (!k) return `<a class="zurueck" href="#kunden">← Kunden</a><p class="leer">Diesen Kunden gibt es nicht (mehr).</p>`;
  const auftraege = auftraegeVon(id).sort((a, b) => auftragDatum(b) - auftragDatum(a));
  const erledigt = auftraege.filter((a) => zahl(a.bekommen) !== null);
  const umsatz = erledigt.reduce((s, a) => s + Number(a.bekommen), 0);
  const tg = erledigt.reduce((s, a) => s + trinkgeld(a), 0);
  const letzter = erledigt.map(auftragDatum).sort((a, b) => b - a)[0];
  const naechster = naechsterTermin(id);
  const fenster = auftraege.find((a) => a.fenster_normal || a.fenster_boden);
  const notizen = daten.notizen.filter((n) => n.kunde_id === id).sort((a, b) => new Date(b.erstellt) - new Date(a.erstellt));
  const fuerDiagramm = [...auftraege].filter((a) => zahl(a.geschaetzt) !== null || zahl(a.bekommen) !== null).reverse().slice(-8);
  const tel = (k.telefon || "").replace(/[^\d+]/g, "");
  const kam = kanalVonKunde(k);

  return `
    <a class="zurueck" href="#kunden">← Kunden</a>
    <div class="kopfzeile">
      <div><h1>${esc(k.name)}</h1><p class="leise">Kunde seit ${esc(fmtDatum.format(new Date(k.erstellt)))}${k.quelle === "website" ? " · über die Website" : ""}</p></div>
      <div class="knopfreihe">
        <label class="feld" style="min-width:170px">
          <span class="visually-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">Status</span>
          <select class="eingabe" data-status-wahl="${esc(k.id)}">
            ${STATUS.map((s) => `<option value="${s.id}"${s.id === k.status ? " selected" : ""}>${esc(s.name)}</option>`).join("")}
          </select>
        </label>
        <button class="knopf" type="button" data-aktion="kunde-bearbeiten" data-id="${esc(k.id)}">Bearbeiten</button>
      </div>
    </div>

    <label class="karte feld weiter-feld">
      <span>Wie geht's weiter? <small class="leise">nur der nächste Schritt, Nachrichten gehören in den Verlauf</small></span>
      <textarea rows="2" data-weiter="${esc(k.id)}" placeholder="Zum Beispiel: Samstag zurückrufen, will auch die Felgen machen lassen">${esc(k.weiter || "")}</textarea>
    </label>

    <div class="raster raster--zwei">
      <section class="karte" aria-labelledby="t-kontakt">
        ${kartenTitel("t-kontakt", "blau", "kontakt", "Kontakt")}
        <div class="kontakt">
          ${k.telefon ? `<a href="tel:${esc(tel)}"><svg viewBox="0 0 24 24"><path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5L17 13l4 1.5v3a2.5 2.5 0 0 1-2.7 2.5C10.9 19.5 4.5 13.1 4 5.7A2.5 2.5 0 0 1 6.5 3Z"/></svg>${esc(k.telefon)}</a>` : ""}
          ${k.email ? `<a href="mailto:${esc(k.email)}"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 8 8 5 8-5"/></svg>${esc(k.email)}</a>` : ""}
          ${k.adresse ? `<a href="https://maps.apple.com/?q=${encodeURIComponent(`${k.adresse}, Berlin`)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>${esc(k.adresse)}</a>` : ""}
          ${k.nebenan_link ? `<a href="${esc(nebenanUrl(k.nebenan_link))}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24">${ICONS.haus}</svg>Auf nebenan.de schreiben</a>` : ""}
          ${!k.telefon && !k.email && !k.adresse && !k.nebenan_link ? `<p class="leise">Noch keine Kontaktdaten.</p>` : ""}
        </div>
        ${kam ? `<p class="kam-ueber">Kam über: <b>${esc(kanalName(kam))}</b></p>` : ""}
        ${werbungText(k) ? `<p class="kam-ueber">Werbung: <b>${esc(werbungText(k))}</b></p>` : ""}
      </section>

      <section class="karte" aria-labelledby="t-zahlen">
        ${kartenTitel("t-zahlen", "himmel", "zahl", "Auf einen Blick")}
        <dl class="werte">
          <div><dt>Besuche</dt><dd>${erledigt.length}</dd></div>
          <div><dt>Umsatz gesamt</dt><dd>${euro(umsatz)}</dd></div>
          <div><dt>davon Trinkgeld</dt><dd>${euro(tg)}${(() => { const q = trinkgeldQuote(erledigt); return q !== null ? ` · Ø ${q} %` : ""; })()}</dd></div>
          <div><dt>Letzter Besuch</dt><dd>${letzter ? esc(fmtDatum.format(letzter)) : "–"}</dd></div>
          <div><dt>Nächster Termin</dt><dd>${naechster ? esc(fmtTag.format(new Date(naechster.datum))) : "–"}</dd></div>
          <div><dt>Fenster</dt><dd>${fenster ? `${fenster.fenster_normal} + ${fenster.fenster_boden} bt.` : "–"}</dd></div>
        </dl>
      </section>
    </div>

    ${fuerDiagramm.length ? `<section class="karte" aria-labelledby="t-diagramm">
      ${kartenTitel("t-diagramm", "bernstein", "zahl", "Geschätzt und bekommen")}
      ${balken(
        fuerDiagramm.map((a) => ({ label: fmtDatum.format(auftragDatum(a)), werte: { g: Number(a.geschaetzt) || 0, b: Number(a.bekommen) || 0 } })),
        [{ id: "g", name: "Geschätzt", farbe: "#C9D6FF" }, { id: "b", name: "Bekommen", farbe: "#010F2B" }]
      )}
    </section>` : ""}

    <section class="karte" aria-labelledby="t-auftraege">
      <div class="karte__kopf">${kartenTitel("t-auftraege", "blau", "termin", "Aufträge und Termine")}<div class="knopfreihe"><button class="knopf knopf--klein" type="button" data-aktion="termin-neu" data-kunde="${esc(k.id)}">+ Termin</button><button class="knopf knopf--klein knopf--voll" type="button" data-aktion="auftrag-neu" data-kunde="${esc(k.id)}">+ Auftrag</button></div></div>
      ${auftraege.length ? `<ul class="liste">${auftraege.map((a) => `<li><button class="zeile" type="button" data-aktion="termin-karte" data-id="${esc(a.id)}" style="width:100%;background:none;border-left:0;border-right:0;border-bottom:0;text-align:left;cursor:pointer">
        ${a.datum ? datumMarke(a.datum) : ""}
        <span class="zeile__haupt">
          <span class="zeile__titel">${kanalMarke(a.kanal)}${esc(auftragTitel(a))}${a.vorlaeufig ? ' <span class="art-marke art-marke--geplant">vorläufig</span>' : ""}${a.abgesagt ? " · abgesagt" : ""}${a.termin_status ? ` · <small style="background:var(--accent-wash);color:var(--accent);padding:0.15rem 0.4rem;border-radius:var(--r-field);font-weight:600;font-size:0.85em">${a.termin_status === "angefragt" ? "angefragt" : a.termin_status === "bestaetigt" ? "bestätigt" : ""}</small>` : ""}</span>
          <span class="zeile__unter">${a.datum ? `${esc(fmtTag.format(new Date(a.datum)))}, ${esc(fmtUhr.format(new Date(a.datum)))} Uhr` : "ohne Termin"}${zahl(a.geschaetzt) !== null ? ` · geschätzt ${euro(a.geschaetzt)}` : ""}</span>
        </span>
        <span class="zeile__rechts">${istTermin(a) ? "" : zahl(a.bekommen) !== null ? `${euro(a.bekommen)}${(() => { const tg = trinkgeld(a); const pct = zahl(a.geschaetzt) !== null && Number(a.geschaetzt) > 0 ? Math.round((tg / Number(a.geschaetzt)) * 100) : 0; return tg ? `<br><small class="plus">+${euro(tg)}${pct > 0 ? ` (${pct} %)` : ""}</small>` : ""; })()}` : `<span class="leise">offen</span>`}</span>
      </button></li>`).join("")}</ul>` : `<p class="leer">Noch kein Auftrag.</p>`}
    </section>

    <section class="karte" aria-labelledby="t-verlauf">
      ${kartenTitel("t-verlauf", "violett", "stift", "Verlauf")}
      <form class="formular" data-notiz-form="${esc(k.id)}">
        <fieldset class="feld">
          <legend>Was trägst du ein?</legend>
          <div class="chips chips--wahl">${Object.entries(NACHRICHT_QUELLEN).map(([id, name]) => `<label class="chip chip--wahl"><input type="radio" name="quelle" value="${id}"${id === "notiz" ? " checked" : ""} />${esc(name)}</label>`).join("")}</div>
        </fieldset>
        <label class="feld"><span>Text</span><textarea name="text" required placeholder="Eigene Notiz oder die Nachricht vom Kunden einfach reinkopieren"></textarea></label>
        <div><button class="knopf knopf--voll knopf--klein" type="submit">Speichern</button></div>
      </form>
      ${notizen.length ? `<ul class="verlauf">${notizen.map(verlaufEintrag).join("")}</ul>` : ""}
    </section>`;
}

// Handy-Kalender: nächste Termine, die Adresse öffnet die Karten-App
function terminListeHandy(termine) {
  return `<section class="karte" aria-labelledby="t-naechste">
    ${kartenTitel("t-naechste", "blau", "termin", "Nächste Termine")}
    ${termine.length ? `<ul class="liste">${termine.map((a) => {
      const k = kundeVon(a.kunde_id);
      const d = new Date(a.datum);
      return `<li class="termin-reihe">
        <button class="zeile zeile--knopf" type="button" data-aktion="termin-karte" data-id="${esc(a.id)}">
          ${datumMarke(a.datum)}
          <span class="zeile__haupt">
            <span class="zeile__titel">${kanalMarke(a.kanal)}${esc(auftragName(a))}${istTermin(a) ? ` <span class="art-marke">${esc(auftragTitel(a))}</span>` : ""}</span>
            <span class="zeile__unter">${esc(fmtTag.format(d))}, ${esc(fmtUhr.format(d))} Uhr${istTermin(a) ? "" : ` · ${esc(a.leistung)}`}</span>
          </span>
        </button>
        ${k?.adresse ? `<a class="kal-adresse" href="https://maps.apple.com/?q=${encodeURIComponent(`${k.adresse}, Berlin`)}" target="_blank" rel="noopener">${esc(k.adresse)} ↗</a>` : ""}
      </li>`;
    }).join("")}</ul>` : `<p class="leer">Keine Termine eingetragen.</p>`}
  </section>`;
}

// Louis und Lukas sehen sich zu ähnlich – deshalb jeder mit eigener Farbe
function personMarke(name) {
  const art = { Louis: "louis", Lukas: "lukas" }[name] || "beide";
  return `<span class="person person--${art}">${esc(name || "Beide")}</span>`;
}

// Alle aktiven Kalender aus der Tabelle; config.js nur als Rückfall, solange keiner eingetragen ist
function sichtbareKalender() {
  const liste = daten.kalender.filter((k) => k.aktiv !== false)
    .sort((a, b) => (a.art === b.art ? a.name.localeCompare(b.name) : a.art === "eintragen" ? -1 : 1));
  if (liste.length) return liste;
  return CFG.KALENDER_ID ? [{ name: "Klar Glas", kalender_id: CFG.KALENDER_ID, art: "eintragen" }] : [];
}

// Farben aus Googles Einbett-Palette: Termine blau, gelesene Kalender abwechselnd bernstein und grau
const KAL_FARBEN = { eintragen: "#3F51B5", lesen: ["#F09300", "#616161", "#8E24AA", "#0B8043"] };

function kalenderFarbe(k, i) {
  return k.art === "eintragen" ? KAL_FARBEN.eintragen : KAL_FARBEN.lesen[i % KAL_FARBEN.lesen.length];
}

function ansichtKalender() {
  const termine = kommendeTermine().slice(0, 10);
  const verbunden = sichtbareKalender().length;
  return `
    <div class="kopfzeile"><div><h1>Kalender</h1><p class="leise">Eure Aufträge und Termine, grau = woanders schon belegt</p></div></div>
    ${verbunden ? "" : `<section class="karte"><h2>Google-Kalender verbinden</h2>
        <p class="leise">Unter <a href="#zeiten">Wann wir können</a> → „+ Kalender hinzufügen“ euren Kalender eintragen. Dann werden belegte Zeiten hier grau angezeigt.</p></section>`}
    ${kalWoche()}
    <section class="karte" aria-labelledby="t-kommend">
      ${kartenTitel("t-kommend", "blau", "uhr", "Kommende Aufträge")}
      ${termine.length ? `<ul class="liste">${termine.map(terminZeile).join("")}</ul>` : `<p class="leer">Keine Termine eingetragen.</p>`}
    </section>`;
}

// Zeitreihe für die Diagramme: 7 Tage der Woche, die 12 Monate des Jahres oder (Monat)
// ein Punkt pro Kalenderwoche über die letzten `monate` Monate bis zum Ende des gewählten Monats.
// Ohne `monate` (Personen-Seiten) wie früher: die letzten 12 Monate.
// Eine Woche gehört zu dem Monat, in dem ihr Montag liegt.
function zeitreihe(zeitraum, stichtag, monate) {
  const monatPunkt = (d) => ({
    von: d,
    bis: new Date(d.getFullYear(), d.getMonth() + 1, 1),
    label: fmtMonatKurz.format(d),
    titel: fmtMonat.format(d),
  });
  const j = stichtag.getFullYear();
  if (zeitraum === "woche") {
    const montag = montagVon(stichtag);
    return {
      untertitel: "Tageswerte dieser Woche",
      punkte: WOCHENTAGE_KURZ.map((label, i) => {
        const von = tagPlus(montag, i);
        return { von, bis: tagPlus(von, 1), label, titel: fmtTagLang.format(von) };
      }),
    };
  }
  if (zeitraum === "jahr") {
    return { untertitel: `Monate ${j}`, punkte: Array.from({ length: 12 }, (_, i) => monatPunkt(new Date(j, i, 1))) };
  }
  const m = stichtag.getMonth();
  if (!monate) return { untertitel: "letzte 12 Monate", punkte: Array.from({ length: 12 }, (_, i) => monatPunkt(new Date(j, m - 11 + i, 1))) };

  const ende = new Date(j, m + 1, 1);
  let start = monate === "alles" ? datenStart() : new Date(j, m - monate + 1, 1);
  if (start >= ende) start = new Date(j, m, 1);
  let montag = montagVon(start);
  if (montag < new Date(start.getFullYear(), start.getMonth(), 1)) montag = tagPlus(montag, 7);
  const punkte = [];
  for (; montag < ende; montag = tagPlus(montag, 7)) {
    const sonntag = tagPlus(montag, 6);
    const kw = kalenderWoche(montag);
    const vorher = punkte[punkte.length - 1];
    punkte.push({
      von: montag,
      bis: tagPlus(montag, 7),
      label: `KW ${kw}`,
      kw,
      monat: MONATE_KURZ[montag.getMonth()],
      neuerMonat: !vorher || vorher.von.getMonth() !== montag.getMonth(),
      imMonat: montag.getMonth() === m && montag.getFullYear() === j,
      titel: `KW ${kw} · ${fmtDatumKurz(montag)}–${fmtDatumKurz(sonntag)}`,
    });
  }
  return { untertitel: monate === "alles" ? "Wochen seit Start" : `Wochen · letzte ${monate} Monate`, punkte, wochen: true };
}

// Erster Tag mit Daten (frühester Auftrag oder Ausgabe), spätestens Oktober 2026
function datenStart() {
  const daten_ = [
    ...daten.auftraege.filter((a) => zahl(a.bekommen) !== null).map((a) => auftragDatum(a)),
    ...daten.ausgaben.map((x) => new Date(x.datum)),
  ].filter((d) => d instanceof Date && !isNaN(d));
  const frueh = daten_.length ? new Date(Math.min(...daten_)) : new Date(2026, 9, 1);
  const okt = new Date(2026, 9, 1);
  return new Date(Math.min(frueh, okt));
}

// Auswahl 2 M · 3 M · 6 M · 12 M · Alles (nur in der Ansicht Monat)
function chartMonateWahl(attr = "data-chart-monate") {
  return `<div class="chart-monate" role="group" aria-label="Wie weit zurück">${CHART_MONATE.map((w) => `<button type="button" ${attr}="${w}" aria-pressed="${zustand.chartMonate === w}">${w === "alles" ? "Alles" : `${w} M`}</button>`).join("")}</div>`;
}

// Achse für Wochen-Diagramme: Hervorhebung des gewählten Monats, Trennlinien, KW- und Monatsnamen
function wochenAchse(punkte, xPos, schritt, { B, H, unten, oben, klein = false }) {
  const n = punkte.length;
  const viele = n > 14;
  const fs = klein ? 9.5 : 11;
  let hinten = "", vorne = "";
  const im = punkte.map((p, i) => (p.imMonat ? i : -1)).filter((i) => i >= 0);
  if (im.length && im.length < n) {
    const x1 = Math.max(0, xPos(im[0]) - schritt / 2);
    const x2 = Math.min(B, xPos(im[im.length - 1]) + schritt / 2);
    hinten += `<rect class="diagramm__monat" x="${x1.toFixed(1)}" y="${oben - 6}" width="${(x2 - x1).toFixed(1)}" height="${(H - unten - oben + 6).toFixed(1)}" rx="8" />`;
  }
  punkte.forEach((p, i) => {
    const x = xPos(i);
    if (p.neuerMonat && i > 0 && n > 14 && n <= 30) {
      const xl = x - schritt / 2;
      hinten += `<line class="diagramm__trenner" x1="${xl.toFixed(1)}" x2="${xl.toFixed(1)}" y1="${oben - 6}" y2="${H - unten}" />`;
    }
    const aktiv = p.imMonat ? " ist-monat" : "";
    if (!viele) {
      vorne += `<text class="diagramm__achse${aktiv}" x="${x.toFixed(1)}" y="${H - unten + 14}" text-anchor="middle" font-size="${fs}">${klein ? p.kw : esc(p.label)}</text>`;
      if (p.neuerMonat) vorne += `<text class="diagramm__achse diagramm__achse--monat${aktiv}" x="${x.toFixed(1)}" y="${H - unten + 27}" text-anchor="middle" font-size="${fs}">${esc(p.monat)}</text>`;
    } else if (p.neuerMonat) {
      const anker = i === 0 ? "start" : "middle";
      const xt = i === 0 ? Math.max(0, x - schritt / 2) : x;
      vorne += `<text class="diagramm__achse diagramm__achse--monat${aktiv}" x="${xt.toFixed(1)}" y="${H - unten + 16}" text-anchor="${anker}" font-size="${fs}">${esc(p.monat)}</text>`;
    }
  });
  return { hinten, vorne };
}

// Diagramm und große Zahl für die Kennzahl im Popup: { titel, wert, diagramm }
function diagrammFuer(zeige, zeitraum, stichtag) {
  const g = zeitraumGrenzen(zeitraum, stichtag);
  const m = zahlenFuer(g.von, g.bis);

  if (zeige === "kasse") {
    const punkte = kassenstandVerlauf().map((v) => ({
      label: fmtDatumKurz(v.datum),
      titel: `${fmtDatum.format(v.datum)} · ${v.bewegung.titel} ${v.bewegung.betrag >= 0 ? "+" : ""}${euro(v.bewegung.betrag)}`,
      wert: v.stand,
    }));
    return { titel: "Kassenstand seit Start", wert: euro(kassenstand()), diagramm: linie(punkte, { format: euro, treppe: true }) };
  }

  const { untertitel, punkte } = zeitreihe(zeitraum, stichtag, zustand.chartMonate);
  const betitel = (name) => `${name} · ${untertitel}`;
  const reihe = (wertVon) => punkte.map((p) => ({ ...p, ...wertVon(p.von, p.bis) }));
  const feld = (name) => reihe((von, bis) => ({ wert: zahlenFuer(von, bis)[name] }));

  if (zeige === "neukunden") {
    const nk = neukundenIm(g.von, g.bis);
    const gruppen = punkte.map((pk) => {
      const x = neukundenIm(pk.von, pk.bis);
      return { ...pk, werte: { neu: x.neu, mit: x.mit } };
    });
    return {
      titel: betitel("Neukunden"),
      wert: `${nk.neu} neu · ${nk.mit} mit Auftrag`,
      diagramm: balken(gruppen, [{ id: "neu", name: "Neu", farbe: "#0FA3B1" }, { id: "mit", name: "Mit Auftrag", farbe: "#2B5CFF" }], String),
    };
  }
  if (zeige === "hochrechnung") {
    const h = hochrechnungMonat();
    const zeilen = h.rest.sort((a, b) => (a.datum ? new Date(a.datum) : Infinity) - (b.datum ? new Date(b.datum) : Infinity)).map((a) => `<li><button class="zeile zeile--knopf" type="button" data-aktion="termin-karte" data-id="${esc(a.id)}" data-diagramm-zu>
      ${a.datum ? datumMarke(a.datum) : `<span class="datum-marke"><b>?</b><small>offen</small></span>`}
      <span class="zeile__haupt"><span class="zeile__titel">${esc(auftragName(a))}</span><span class="zeile__unter">${a.datum ? esc(fmtTag.format(new Date(a.datum))) : "Datum fehlt"} · ${esc(a.leistung || "")}${a.vorlaeufig || a.termin_status === "angefragt" ? " · noch nicht fest" : ""}</span></span>
      <span class="zeile__rechts leise">${zahl(a.geschaetzt) !== null ? `~${euro(a.geschaetzt)}` : `Ø ${euro(h.schnitt)}`}</span>
    </button></li>`).join("");
    return {
      titel: `Hochrechnung ${h.monat}`,
      wert: `~${euro(h.gesamt)}`,
      diagramm: `<p class="hinweis">${euro(h.bekommen)} schon bekommen + ${euro(h.offen)} geschätzt für ${h.rest.length} offene ${h.rest.length === 1 ? "Auftrag" : "Aufträge"}${h.ohneSchaetzung ? ` (${h.ohneSchaetzung} ohne Schätzung, dafür Ø ${euro(h.schnitt)})` : ""}.</p>${zeilen ? `<ul class="liste">${zeilen}</ul>` : ""}`,
    };
  }
  if (zeige === "marge") {
    return {
      titel: betitel("Marge"),
      wert: m.marge === null ? "–" : `${m.marge} %`,
      diagramm: linie(reihe((von, bis) => ({ wert: zahlenFuer(von, bis).marge ?? 0 })), { format: (w) => (w === 0 ? "–" : `${w} %`) }),
    };
  }
  if (zeige === "trinkgeld") {
    return {
      titel: betitel("Trinkgeld"),
      wert: euro(m.trinkgeld),
      diagramm: linie(
        reihe((von, bis) => {
          const bezahlt = bezahltImZeitraum(von, bis);
          return { wert: bezahlt.reduce((s, a) => s + trinkgeld(a), 0), quote: trinkgeldQuote(bezahlt) };
        }),
        { format: euro, mitProzent: true }
      ),
    };
  }
  if (zeige === "auftraege") {
    return { titel: betitel("Aufträge"), wert: String(m.auftraege), diagramm: linie(reihe((von, bis) => ({ wert: bezahltImZeitraum(von, bis).length })), { format: (w) => String(w) }) };
  }
  if (zeige.startsWith("kz-")) {
    const k = kennzahlenFuer(g.von, g.bis);
    const kz = (fn) => reihe((von, bis) => ({ wert: Math.round((fn(kennzahlenFuer(von, bis)) || 0) * 100) / 100 }));
    if (zeige === "kz-auftrag") return { titel: betitel("Ø pro Auftrag"), wert: euroOder(k.proAuftrag), diagramm: linie(kz((x) => x.proAuftrag), { format: euro }) };
    if (zeige === "kz-stunde") return { titel: betitel("Ø pro Stunde & Person"), wert: euroOder(k.proStundePerson), diagramm: linie(kz((x) => x.proStundePerson), { format: euro }) + `<p class="hinweis">${k.auftraege ? `Zusammen ${euroOder(k.proStunde)} pro Stunde · ${stundenText(k.stunden * 60)} gearbeitet · ${k.geschaetzt} von ${k.auftraege} Dauern geschätzt (keine echte Dauer eingetragen)` : ""}</p>` };
    if (zeige === "kz-fenster") return { titel: betitel("Ø pro Fenster"), wert: euroOder(k.proFenster), diagramm: linie(kz((x) => x.proFenster), { format: euro }) };
    if (zeige === "kz-kasse") return { titel: betitel("Kasse pro Stunde"), wert: euroOder(k.kasseProStunde), diagramm: linie(kz((x) => x.kasseProStunde), { format: euro }) };
    // Löhne: Balken pro Person und Zeitabschnitt, darunter die Namen zum Anklicken
    const namen = [...new Set(daten.auszahlungen.filter((x) => x.art === "lohn").map((x) => x.an))].sort((a, b) => a.localeCompare(b, "de"));
    const FARBEN = ["#5B3FD6", "#2B5CFF", "#D08A00", "#1E9E5A", "#E67C73", "#0F7A4B"];
    const gruppen = punkte.map((pk) => ({ ...pk, werte: kennzahlenFuer(pk.von, pk.bis).proPerson }));
    const liste = namen.length
      ? `<ul class="liste lohn-liste">${namen.map((n) => `<li><a class="zeile" href="#mitarbeiter/${encodeURIComponent(n)}" data-diagramm-zu><span class="zeile__haupt"><span class="zeile__titel">${esc(n)}</span></span><span class="zeile__rechts">${euro(k.proPerson[n] || 0)}</span></a></li>`).join("")}</ul>`
      : `<p class="leer">Noch keine Löhne.</p>`;
    return {
      titel: betitel("Löhne"),
      wert: euro(k.loehne),
      diagramm: (namen.length ? balken(gruppen, namen.map((n, i) => ({ id: n, name: n, farbe: FARBEN[i % FARBEN.length] }))) : "") + liste,
    };
  }
  if (zeige === "ausgaben") {
    return { titel: betitel("Ausgaben"), wert: euro(m.ausgaben), diagramm: linie(feld("ausgaben"), { format: euro }) };
  }
  if (zeige === "gewinn") {
    return { titel: betitel("Gewinn"), wert: euro(m.gewinn), diagramm: linie(feld("gewinn"), { format: euro }) };
  }
  return { titel: betitel("Umsatz"), wert: euro(m.umsatz), diagramm: linie(feld("umsatz"), { format: euro }) };
}

// Auf dem Handy immer der Monat; am Computer der gewählte Zeitraum
const aktuellerZeitraum = () => zustand.geldZeitraum;

// Aufteilung 50/50 (nur Desktop): wer bekommt noch wie viel
function aufteilungKarte() {
  const ks = konten();
  const kasse = kassenstand();
  const farbe = { Louis: "blau", Lukas: "violett" };
  const kachelFuer = (p) =>
    p.guthaben < -0.004
      ? kachel(p.name, `<span class="minus">${euro(p.guthaben)}</span>`, `<span class="minus">im Minus</span>`, false, null, farbe[p.name])
      : kachel(p.name, euro(p.guthaben), "auf dem Konto", false, null, farbe[p.name]);
  const zeile = (titel, wert, vz = "") =>
    `<div class="aufteilung__zeile"><span class="leise">${titel}</span>${ks.map((p) => `<span>${wert(p) ? vz : ""}${euro(wert(p))}</span>`).join("")}</div>`;
  return `<section class="karte" aria-labelledby="t-aufteilung">
    ${kartenTitel("t-aufteilung", "violett", "zahl", "Eure Konten")}
    <div class="aufteilung__kacheln">${ks.map(kachelFuer).join("")}</div>
    <div class="aufteilung__zeilen">
      <div class="aufteilung__zeile aufteilung__zeile--kopf"><span></span>${ks.map((p) => `<span>${esc(p.name)}</span>`).join("")}</div>
      ${zeile("aus Aufträgen", (p) => p.auftraege, "+")}
      ${zeile("selbst ausgelegt", (p) => p.ausgelegt, "+")}
      ${zeile("Ausgaben (Hälfte)", (p) => p.ausgaben, "−")}
      ${zeile("schon ausgezahlt", (p) => p.ausgezahlt, "−")}
    </div>
    <div class="knopfreihe">${ks.map((p) => `<button class="knopf knopf--klein${p.guthaben > 0.004 ? " knopf--voll" : ""}" type="button" data-aktion="konto-auszahlen" data-wert="${esc(p.name)}">${esc(p.name)} auszahlen</button>`).join("")}</div>
    <p class="hinweis">Zusammen ${euro(ks.reduce((s, p) => s + p.guthaben, 0))} = Kassenstand ${euro(kasse)}. Allein: ${alleinStandard()} / ${100 - alleinStandard()} · Beide da: ${louisStandard()} / ${100 - louisStandard()} · Ausgaben halbe-halbe.</p>
  </section>`;
}

// Woche / Monat / Jahr mit Pfeilen (Geld-Seite und Personen-Seite)
function zeitraumWahl(g) {
  const z = zustand;
  const schritt = { woche: ["Vorwoche", "Nächste Woche"], monat: ["Vormonat", "Nächster Monat"], jahr: ["Vorjahr", "Nächstes Jahr"] }[aktuellerZeitraum()];
  const zeitraumNamen = { woche: "Woche", monat: "Monat", jahr: "Jahr" };
  return `<div class="zeitraum">
      <div class="segment" role="group" aria-label="Zeitraum wählen">
        <span class="segment__pille" aria-hidden="true" data-ziel="${ZEITRAUM_POS[z.geldZeitraum]}" style="--i:${z.geldPillePrev ?? ZEITRAUM_POS[z.geldZeitraum]}"></span>
        ${Object.keys(ZEITRAUM_POS).map((w) => `<button class="segment__knopf" type="button" aria-pressed="${z.geldZeitraum === w}" data-aktion="zeitraum" data-wert="${w}">${zeitraumNamen[w]}</button>`).join("")}
      </div>
      <div class="zeitraum__nav">
        <button class="knopf knopf--klein knopf--leise" type="button" data-aktion="schritt" data-wert="-1" aria-label="${schritt[0]}">‹</button>
        <h2 class="zeitraum__titel">${esc(g.label)}</h2>
        <button class="knopf knopf--klein knopf--leise" type="button" data-aktion="schritt" data-wert="1" aria-label="${schritt[1]}">›</button>
      </div>
    </div>`;
}

// Nur am Computer: Durchschnitte, folgen dem Zeitraum oben
// Neue Kunden im Zeitraum, davon wie viele schon einen Auftrag haben
function neukundenIm(von, bis) {
  const neu = daten.kunden.filter((k) => k.erstellt && new Date(k.erstellt) >= von && new Date(k.erstellt) < bis);
  const mit = neu.filter((k) => daten.auftraege.some((a) => a.kunde_id === k.id && !a.abgesagt && !istTermin(a)));
  return { neu: neu.length, mit: mit.length };
}

// Hochrechnung für den laufenden Monat: schon bekommen + Schätzung der restlichen Aufträge
function hochrechnungMonat() {
  const g = zeitraumGrenzen("monat", new Date());
  const bekommen = zahlenFuer(g.von, g.bis).umsatz;
  const bezahlt = daten.auftraege.filter((a) => zahl(a.bekommen) !== null);
  const schnitt = bezahlt.length ? bezahlt.reduce((s, a) => s + Number(a.bekommen), 0) / bezahlt.length : 0;
  // Alle offenen Aufträge dieses Monats – auch vorläufige, angefragte und welche ohne Datum (Ø, wenn nichts geschätzt)
  const rest = daten.auftraege.filter(
    (a) =>
      !istTermin(a) &&
      !a.abgesagt &&
      a.termin_status !== "abgelehnt" &&
      zahl(a.bekommen) === null &&
      (!a.datum || (new Date(a.datum) >= g.von && new Date(a.datum) < g.bis))
  );
  const offen = rest.reduce((s, a) => s + (zahl(a.geschaetzt) !== null ? Number(a.geschaetzt) : schnitt), 0);
  const ohneSchaetzung = rest.filter((a) => zahl(a.geschaetzt) === null).length;
  return { bekommen, offen, gesamt: bekommen + offen, rest, schnitt, ohneSchaetzung, monat: fmtMonat.format(g.von).split(" ")[0] };
}

const istLaufenderMonat = (g) => aktuellerZeitraum() === "monat" && g.von <= new Date() && new Date() < g.bis;

function kennzahlenReihe(g) {
  const k = kennzahlenFuer(g.von, g.bis);
  const kacheln = [
    ["kz-auftrag", "Ø pro Auftrag", euroOder(k.proAuftrag), `${k.auftraege} bezahlt`, "blau"],
    ["kz-stunde", "Ø pro Stunde & Person", euroOder(k.proStundePerson), k.auftraege ? `zusammen ${euroOder(k.proStunde)} · ${stundenText(k.stunden * 60)}${k.geschaetzt ? ` · ${k.geschaetzt} geschätzt` : ""}` : "", "gruen"],
    ["kz-fenster", "Ø pro Fenster", euroOder(k.proFenster), k.fensterProAuftrag ? `Ø ${Math.round(k.fensterProAuftrag * 10) / 10} Fenster pro Auftrag`.replace(".", ",") : "", "himmel"],
    ["kz-loehne", "Löhne", euro(k.loehne), Object.keys(k.proPerson).length ? Object.entries(k.proPerson).map(([n, b]) => `${esc(n)} ${euro(b)}`).join(" · ") : "an Mitarbeiter", "violett"],
    ["kz-kasse", "Kasse pro Stunde", euroOder(k.kasseProStunde), "nach den Löhnen", "bernstein"],
  ];
  const nk = neukundenIm(g.von, g.bis);
  kacheln.push(["neukunden", "Neukunden", `${nk.neu} neu`, `davon ${nk.mit} mit Auftrag`, "himmel"]);
  if (istLaufenderMonat(g)) {
    const h = hochrechnungMonat();
    kacheln.push(["hochrechnung", `Hochrechnung ${esc(h.monat)}`, `~${euro(h.gesamt)}`, `${euro(h.bekommen)} da + ${h.rest.length} offen`, "gruen"]);
  }
  return `<section class="kennzahlen" aria-labelledby="t-kennzahlen">
    <h2 class="kennzahlen__titel" id="t-kennzahlen">Kennzahlen</h2>
    <div class="raster raster--kacheln raster--kennzahlen">
      ${kacheln.map(([id, titel, wert, info, farbe]) => `<button class="kachel kachel--tab kachel--${farbe}" type="button" data-aktion="geld-tab" data-wert="${id}">
        <span class="kachel__titel">${titel}</span>
        <span class="kachel__wert">${wert}</span>
        ${info ? `<span class="kachel__info">${info}</span>` : ""}
      </button>`).join("")}
    </div>
  </section>`;
}

function ansichtGeld() {
  const z = zustand;
  const handy = istHandy();
  const g = zeitraumGrenzen(aktuellerZeitraum(), z.geldStichtag);
  const m = zahlenFuer(g.von, g.bis);
  const v = zahlenFuer(g.vorVon, g.vorBis);
  const erstattungen = offeneErstattungen();
  const bewegungen = bewegungenListe().slice(0, handy ? 5 : 40);

  // Bewegungen nach Datum gruppieren (die Liste ist schon sortiert, neueste zuerst)
  const heute = new Date().toDateString();
  const gestern = tagPlus(new Date(), -1).toDateString();
  const tagName = (d) => (d.toDateString() === heute ? "Heute" : d.toDateString() === gestern ? "Gestern" : fmtTag.format(d));
  const gruppen = [];
  bewegungen.forEach((b) => {
    const schluessel = b.datum.toDateString();
    const letzte = gruppen[gruppen.length - 1];
    if (letzte && letzte.schluessel === schluessel) letzte.eintraege.push(b);
    else gruppen.push({ schluessel, titel: tagName(b.datum), eintraege: [b] });
  });

  const PFEILE = {
    rein: { farbe: "gruen", pfad: '<path d="M12 4v15m0 0-5-5m5 5 5-5"/>' },
    aus: { farbe: "rot", pfad: '<path d="M12 20V5m0 0-5 5m5-5 5 5"/>' },
    auszahlung: { farbe: "blau", pfad: '<path d="M4 12h15m0 0-5-5m5 5-5 5"/>' },
    lohn: { farbe: "violett", pfad: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.6-3.6 3.5-6 7-6s6.4 2.4 7 6"/>' },
  };

  const bewegungZeile = (b) => {
    const pfeil = PFEILE[b.art];
    const innen = `<span class="bewegung-icon bewegung-icon--${pfeil.farbe}" aria-hidden="true"><svg viewBox="0 0 24 24">${pfeil.pfad}</svg></span>
      <span class="zeile__haupt"><span class="zeile__titel">${esc(b.titel)}</span>${b.unter ? `<span class="zeile__unter">${esc(b.unter)}</span>` : ""}</span>
      <span class="zeile__rechts ${b.betrag >= 0 ? "plus" : "minus"}">${b.betrag >= 0 ? "+" : ""}${euro(b.betrag)}</span>`;
    return b.link
      ? `<li><a class="zeile" href="${esc(b.link)}">${innen}</a></li>`
      : `<li><button class="zeile" type="button" data-aktion="${b.aktion}" data-id="${esc(b.id)}" style="width:100%;background:none;border-left:0;border-right:0;border-bottom:0;text-align:left;cursor:pointer">${innen}</button></li>`;
  };

  const quote = trinkgeldQuote(bezahltImZeitraum(g.von, g.bis));
  const alleTabs = [
    ["umsatz", "Umsatz", euro(m.umsatz), veraenderung(m.umsatz, v.umsatz, g.vergleich), "blau"],
    ["ausgaben", "Ausgaben", euro(m.ausgaben), "", "himmel"],
    ["gewinn", "Gewinn", euro(m.gewinn), veraenderung(m.gewinn, v.gewinn, g.vergleich), "gruen"],
    ["marge", "Marge", m.marge === null ? "–" : `${m.marge} %`, "Gewinn vom Umsatz", "violett"],
    ["trinkgeld", "Trinkgeld", euro(m.trinkgeld), quote !== null ? `Ø ${quote} % extra` : "", "bernstein"],
    ["auftraege", "Aufträge", String(m.auftraege), "bezahlt", "blau"],
    ["kasse", "Kassenstand", euro(kassenstand()), "jetzt", "navy"],
  ];
  const tabs = handy ? ["kasse", "umsatz", "gewinn", "ausgaben", "trinkgeld", "auftraege"].map((id) => alleTabs.find((t) => t[0] === id)) : alleTabs;
  return `
    <div class="kopfzeile">
      <div><h1>Geld</h1><p class="leise">Alles bar, alles in einer Kasse</p></div>
      <div class="knopfreihe">
        <button class="knopf" type="button" data-aktion="auszahlung-neu">Auszahlung</button>
        <button class="knopf knopf--voll" type="button" data-aktion="ausgabe-neu">Ausgabe eintragen</button>
      </div>
    </div>

    ${zeitraumWahl(g)}

    <div class="${handy ? "raster raster--geld-handy" : "raster raster--kacheln raster--tabs"}" role="group" aria-label="Kennzahl für das Diagramm wählen">
      ${tabs.map(([id, titel, wert, info, farbe]) => `<button class="kachel kachel--tab kachel--${farbe}${handy && id === "kasse" ? " kachel--gross" : ""}" type="button" data-aktion="geld-tab" data-wert="${id}">
        <span class="kachel__titel">${titel}</span>
        <span class="kachel__wert">${wert}</span>
        ${info ? `<span class="kachel__info">${info}</span>` : ""}
      </button>`).join("")}
    </div>

    ${handy ? "" : kennzahlenReihe(g)}

    <div class="raster raster--zwei" ${handy ? "hidden" : ""}>
      <div class="geld-links">
      <section class="karte karte--kasse" aria-labelledby="t-kasse">
        ${kartenTitel("t-kasse", "weiss", "geld", "Kasse")}
        ${kachel("Kassenstand", euro(kassenstand()), "Einnahmen minus Ausgaben aus der Kasse minus Auszahlungen", true, null, "kasse")}
        ${erstattungen.length ? `<div class="kasse__erstattung">
          <h3>Noch zu erstatten</h3>
          <ul class="liste">${erstattungen.map((x) => `<li class="zeile">
            <span class="zeile__haupt"><span class="zeile__titel">${esc(x.bezahlt_von)}: ${esc(x.kategorie)}</span><span class="zeile__unter">${esc(fmtDatum.format(new Date(x.datum)))}${x.notiz ? ` · ${esc(x.notiz)}` : ""}</span></span>
            <span class="zeile__rechts">${euro(x.betrag)}</span>
            <button class="knopf knopf--klein" type="button" data-aktion="erstatten" data-id="${esc(x.id)}">Erstatten</button>
          </li>`).join("")}</ul>
        </div>` : ""}
      </section>
      ${handy ? "" : aufteilungKarte()}
      </div>

      <section class="karte karte--bewegungen" aria-labelledby="t-bewegungen">
        ${kartenTitel("t-bewegungen", "himmel", "bewegung", handy ? "Letzte Bewegungen" : "Bewegungen")}
        ${gruppen.length ? gruppen.map((gr) => `<div class="bewegung-tag">
          <h3>${esc(gr.titel)}</h3>
          <ul class="liste">${gr.eintraege.map(bewegungZeile).join("")}</ul>
        </div>`).join("") : `<p class="leer">Noch nichts eingetragen.</p>`}
      </section>
    </div>`;
}

function ansichtAufgaben() {
  const f = zustand.aufgabenFilter;
  const liste = sichtbareAufgaben()
    .filter((a) => (f === "erledigt" ? a.erledigt : !a.erledigt))
    .filter((a) => !PERSONEN.includes(f) || a.zustaendig === f || a.zustaendig === "Beide")
    .sort(f === "erledigt" ? (a, b) => new Date(b.erstellt) - new Date(a.erstellt) : nachFaelligkeit);
  const filter = [["offen", "Offen"], ["Louis", "Louis"], ["Lukas", "Lukas"], ["erledigt", "Erledigt"]];
  return `
    <div class="kopfzeile">
      <div><h1>Aufgaben</h1><p class="leise">${sichtbareAufgaben().filter((a) => !a.erledigt).length} offen</p></div>
      <button class="knopf knopf--voll" type="button" data-aktion="aufgabe-neu">Neue Aufgabe</button>
    </div>
    <div class="chips" role="group" aria-label="Aufgaben filtern">
      ${filter.map(([wert, name]) => `<button class="chip" type="button" aria-pressed="${f === wert}" data-aktion="aufgaben-filter" data-wert="${wert}">${name}</button>`).join("")}
    </div>
    ${!liste.length ? `<section class="karte"><p class="leer">${f === "erledigt" ? "Noch nichts erledigt." : "Nichts offen. Stark."}</p></section>`
      : f === "erledigt" ? `<section class="karte"><ul class="liste">${liste.map(aufgabeZeile).join("")}</ul></section>`
      : aufgabenAbschnitte(liste).map(([titel, l]) => `<section class="karte aufgaben-abschnitt"><h2 class="aufgaben-abschnitt__titel">${titel} <span class="leise">${l.length}</span></h2><ul class="liste">${l.map(aufgabeZeile).join("")}</ul></section>`).join("")}
    ${istIos ? `<p class="hinweis">„In OutPost“ legt die Aufgabe in deiner Erinnerungen-Liste „Klar Glas“ an.</p>` : ""}`;
}

// Einstellungen (nur am Computer verlinkt): Preise und Stundenlohn
// Einstellungen: Anteil pro Kopf + Mitarbeiter
function teamKarte() {
  const alle = [...daten.mitarbeiter].sort((a, b) => (a.aktiv === false) - (b.aktiv === false) || a.name.localeCompare(b.name, "de"));
  const zeile = (name, unter, archiviert = false) => {
    const z = personZahlen(name);
    return `<li><a class="zeile${archiviert ? " zeile--archiviert" : ""}" href="#mitarbeiter/${encodeURIComponent(name)}">
      <span class="tk-avatar team-avatar" aria-hidden="true">${esc(tkInitialen(name))}</span>
      <span class="zeile__haupt"><span class="zeile__titel">${esc(name)}</span><span class="zeile__unter">${unter} · ${z.einsaetze.length} ${z.einsaetze.length === 1 ? "Einsatz" : "Einsätze"}</span></span>
      <span class="zeile__rechts">${euro(z.lohn)}</span>
    </a></li>`;
  };
  return `<section class="karte" aria-labelledby="t-team">
    <div class="karte__kopf">${kartenTitel("t-team", "gruen", "kunden", "Team")}<button class="knopf knopf--klein knopf--voll" type="button" data-aktion="mitarbeiter-neu">Mitarbeiter hinzufügen</button></div>
    <label class="feld team-anteil"><span>Anteil pro Kopf</span>
      <span class="eingabe-euro"><input type="number" class="eingabe" inputmode="decimal" min="0" max="100" step="1" value="${esc(standardAnteil())}" data-einstell="true" data-einstell-field="anteil_prozent" /><span aria-hidden="true">%</span></span>
      <small class="leise">So viel nimmt ein Mitarbeiter bar mit. Ist einer von euch mit ihm da, kommt derselbe Anteil auf dessen Konto, der Rest wird geteilt.</small>
    </label>
    <div class="feldreihe">
      <label class="feld team-anteil"><span>Einer von euch allein</span>
        <span class="eingabe-euro"><input type="number" class="eingabe" inputmode="decimal" min="0" max="100" step="1" value="${esc(alleinStandard())}" data-einstell="true" data-einstell-field="allein_prozent" /><span aria-hidden="true">%</span></span>
        <small class="leise">So viel kriegt, wer allein war (mit Mitarbeiter: vom Rest nach dessen Anteil). Der andere ${100 - alleinStandard()} %.</small>
      </label>
      <label class="feld team-anteil"><span>Ihr beide: Louis-Anteil</span>
        <span class="eingabe-euro"><input type="number" class="eingabe" inputmode="decimal" min="0" max="100" step="1" value="${esc(louisStandard())}" data-einstell="true" data-einstell-field="beide_louis_prozent" /><span aria-hidden="true">%</span></span>
        <small class="leise">Lukas bekommt ${100 - louisStandard()} %. Gilt auch für den Rest, wenn ihr beide mit Mitarbeiter da seid.</small>
      </label>
    </div>
    <p class="hinweis">Änderungen gelten nur für neue Aufträge – bezahlte behalten ihre Prozente.</p>
    <ul class="liste team-liste">
      ${PERSONEN.map((n) => zeile(n, "Chef")).join("")}
      ${alle.map((m) => zeile(m.name, m.aktiv === false ? "archiviert" : "Mitarbeiter", m.aktiv === false)).join("")}
    </ul>
  </section>`;
}

// Seite pro Person: was sie verdient hat, wie lange, bei wem
function ansichtMitarbeiter(roh) {
  const name = decodeURIComponent(roh || "");
  const m = daten.mitarbeiter.find((x) => x.name === name);
  const chef = PERSONEN.includes(name);
  if (!m && !chef && !daten.auszahlungen.some((x) => x.an === name)) {
    return `<a class="zurueck" href="#einstellungen">← Einstellungen</a><p class="leer">Diese Person gibt es nicht (mehr).</p>`;
  }
  const z = zustand;
  const zeitraum = aktuellerZeitraum();
  const g = zeitraumGrenzen(zeitraum, z.geldStichtag);
  const jetzt = personZahlen(name, g.von, g.bis);
  const gesamt = personZahlen(name);
  const reihe = gesamt.einsaetze;
  const erster = reihe[reihe.length - 1];
  const letzter = reihe[0];
  const { untertitel, punkte } = zeitreihe(zeitraum, z.geldStichtag);
  const gruppen = punkte.map((p) => ({ label: p.label, werte: { lohn: personZahlen(name, p.von, p.bis).lohn } }));
  const zeitraumNamen = { woche: "Woche", monat: "Monat", jahr: "Jahr" };

  const einsatzZeile = (a) => {
    const d = dauerVon(a);
    return `<li><button class="zeile zeile--knopf" type="button" data-aktion="termin-karte" data-id="${esc(a.id)}">
      ${datumMarke(a.datum || a.erstellt)}
      <span class="zeile__haupt"><span class="zeile__titel">${esc(auftragName(a))}</span>
        <span class="zeile__unter">${esc(a.leistung || "")} · ${d.geschaetzt ? "ca. " : ""}${stundenText(d.min)} · mit ${esc(teamVon(a).filter((n) => n !== name).join(", ") || "niemandem")}</span></span>
      <span class="zeile__rechts">${euro(lohnFuer(name, a))}<small class="leise"> von ${euro(a.bekommen)}</small></span>
    </button></li>`;
  };

  return `
    <a class="zurueck" href="#einstellungen">← Team</a>
    <div class="kopfzeile">
      <div class="person-kopf">
        <span class="tk-avatar person-kopf__avatar" aria-hidden="true">${esc(tkInitialen(name))}</span>
        <div><h1>${esc(name)}</h1><p class="leise">${chef ? "Chef – hier zählt nur der Lohn aus Aufträgen ohne den anderen, nicht der 50/50-Anteil" : m?.aktiv === false ? "Archiviert" : "Mitarbeiter"}</p></div>
      </div>
      ${m ? `<div class="knopfreihe">
        <button class="knopf" type="button" data-aktion="mitarbeiter-umbenennen" data-id="${esc(m.id)}">Umbenennen</button>
        <button class="knopf" type="button" data-aktion="mitarbeiter-archivieren" data-id="${esc(m.id)}">${m.aktiv === false ? "Zurückholen" : "Archivieren"}</button>
      </div>` : ""}
    </div>

    ${zeitraumWahl(g)}

    <div class="raster raster--kacheln person-kacheln">
      ${kachel("Insgesamt bekommen", euro(gesamt.lohn), `seit Start · ${esc(g.label)}: ${euro(jetzt.lohn)}`, true, null, "kasse")}
      ${kachel("Ø pro Stunde", euroOder(gesamt.proStunde), jetzt.proStunde !== null ? `${esc(zeitraumNamen[zeitraum])}: ${euroOder(jetzt.proStunde)}` : "", false, null, "gruen")}
      ${kachel("Stunden", stundenText(gesamt.minuten), `${esc(zeitraumNamen[zeitraum])}: ${stundenText(jetzt.minuten)}`, false, null, "blau")}
      ${kachel("Aufträge", String(reihe.length), `${esc(zeitraumNamen[zeitraum])}: ${jetzt.einsaetze.length}`, false, null, "himmel")}
      ${kachel("Ø pro Auftrag", euroOder(gesamt.proAuftrag), "Lohn pro Einsatz", false, null, "violett")}
      ${kachel("Umsatz mit " + esc(name), euro(gesamt.umsatz), "so viel kam bei seinen Einsätzen rein", false, null, "bernstein")}
      ${kachel("Erster Einsatz", erster ? esc(fmtDatum.format(auftragDatum(erster))) : "–", letzter ? `zuletzt ${esc(fmtDatum.format(auftragDatum(letzter)))}` : "", false, null, "navy")}
    </div>

    <div class="raster raster--zwei">
      <section class="karte" aria-labelledby="t-person-lohn">
        ${kartenTitel("t-person-lohn", "violett", "zahl", `Lohn · ${esc(untertitel)}`)}
        ${reihe.length ? balken(gruppen, [{ id: "lohn", name: "Lohn", farbe: "#5B3FD6" }]) : `<p class="leer">Noch keine Einsätze.</p>`}
      </section>
      <section class="karte" aria-labelledby="t-person-einsaetze">
        ${kartenTitel("t-person-einsaetze", "blau", "termin", "Einsätze")}
        ${reihe.length ? `<ul class="liste">${reihe.map(einsatzZeile).join("")}</ul>` : `<p class="leer">Noch keine bezahlten Einsätze.</p>`}
      </section>
    </div>`;
}

function ansichtEinstellungen() {
  const p = preise();
  const feld = (name, titel, schritt, hinweis = "") => `<label class="feld"><span>${titel}</span>
      <span class="eingabe-euro"><input type="number" class="eingabe" inputmode="decimal" min="0" step="${schritt}" value="${p[name]}" data-einstell="true" data-einstell-field="${name}" /><span aria-hidden="true">€</span></span>
      ${hinweis ? `<small class="leise">${hinweis}</small>` : ""}</label>`;
  return `
    <div class="kopfzeile"><div><h1>Einstellungen</h1><p class="leise">Änderungen gelten sofort für neue Aufträge und Website-Anfragen</p></div></div>
    <div class="raster raster--zwei">
      <section class="karte">
        ${kartenTitel("t-preise-fenster", "blau", "zahl", "Fensterreinigung")}
        <div class="feldreihe">
          ${feld("preis_normal", "Normales Fenster", "0.5")}
          ${feld("preis_boden", "Bodentiefes Fenster", "0.5")}
        </div>
        ${feld("mindestpreis", "Mindestauftrag", "1", "Kleinere Aufträge werden auf diesen Betrag aufgerundet.")}
      </section>
      <section class="karte">
        ${kartenTitel("t-preise-stunde", "bernstein", "uhr", "Nachbarschaftshilfe & Felgen")}
        ${feld("stundensatz", "Stundenlohn", "0.5", "Vorschlag für neue Aufträge. Im Auftrag selbst kannst du ihn ändern oder auf Festpreis umstellen.")}
      </section>
    </div>
    ${teamKarte()}
    <section class="karte">
      <div class="karte__kopf">${kartenTitel("t-kanaele", "himmel", "web", "Woher Kunden kommen")}<button class="knopf knopf--klein knopf--voll" type="button" data-aktion="kanal-neu">Kontaktweg hinzufügen</button></div>
      <ul class="kanal-liste">${kanaeleWaehlbar().map(([kid, k]) => `<li>${kanalMarke(kid)}<span>${esc(k.name)}</span>${k.eigen ? `<button class="knopf knopf--klein knopf--leise" type="button" data-aktion="kanal-weg" data-id="${esc(kid)}">Entfernen</button>` : `<small class="leise">fest</small>`}</li>`).join("")}</ul>
    </section>
    <section class="karte">
      <div class="karte__kopf">${kartenTitel("t-push", "violett", "anfrage", "Mitteilungen bei neuen Anfragen")}<button class="knopf knopf--klein${pushAn ? " knopf--leise" : " knopf--voll"}" type="button" data-aktion="push-umschalten">${pushAn ? "Ausschalten" : "Einschalten"}</button></div>
      <p class="leise" style="margin:0">${esc(pushText())} Gilt nur für dieses Gerät – am Handy und am Mac je einmal einschalten.</p>
    </section>
    <p class="hinweis">Die Preise, die auf der Website stehen, ändern sich dadurch nicht automatisch – die Texte dort müssen separat angepasst werden. Termine, Dauer und Kalender stellst du unter <a href="#zeiten">Wann wir können</a> ein.</p>`;
}

function ansichtZeiten() {
  const wochentage = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  const einstell = daten.einstellungen[0] || { id: 1, slot_minuten: 60, slot_schritt: 30, vorlauf_stunden: 12, tage_voraus: 14 };
  const zeiten = daten.verfuegbarkeit || [];

  return `
    <a class="zurueck" href="#uebersicht">← Übersicht</a>
    <div class="kopfzeile"><div><h1>Wann wir können</h1><p class="leise">Zeiten für neue Terminanfragen</p></div></div>

    <section class="karte">
      ${kartenTitel("t-oeffnung", "blau", "uhr", "Öffnungszeiten pro Wochentag")}
      <p class="hinweis">Belegte Zeiten aus euren Kalendern und Blockern werden automatisch abgezogen.</p>
      ${wochentage.map((tag, i) => {
        const wochentag = i + 1;
        const tageszeiten = zeiten.filter((z) => z.wochentag === wochentag).sort((a, b) => a.von.localeCompare(b.von));
        return `<div class="zeitzeile">
          <span class="zeitzeile__tag">${tag}</span>
          <div class="zeitzeile__fenster">
            ${tageszeiten.map((z) => `<div class="zeitfenster">
              <input type="time" class="eingabe" value="${z.von}" data-verfueg-id="${esc(z.id)}" data-verfueg-field="von" />
              <span>–</span>
              <input type="time" class="eingabe" value="${z.bis}" data-verfueg-id="${esc(z.id)}" data-verfueg-field="bis" />
              <button class="knopf knopf--klein knopf--leise" type="button" data-aktion="verfueg-entfernen" data-id="${esc(z.id)}" aria-label="Zeitfenster löschen">×</button>
            </div>`).join("")}
            <button class="knopf knopf--klein knopf--leise" type="button" data-aktion="verfueg-add" data-wert="${wochentag}" data-tag="${esc(tag)}">+ Fenster</button>
          </div>
        </div>`;
      }).join("")}
    </section>

    <section class="karte">
      ${kartenTitel("t-einstell", "violett", "zahl", "Einstellungen")}
      <label class="feld"><span>Länge neuer Website-Termine (Min.)</span><input type="number" class="eingabe" value="${einstell.slot_minuten}" min="15" step="15" data-einstell="true" data-einstell-field="slot_minuten" /></label>
      <label class="feld"><span>Puffer vor/nach Terminen (Min.)</span><input type="number" class="eingabe" value="${einstell.puffer_min ?? 30}" min="0" step="15" data-einstell="true" data-einstell-field="puffer_min" /></label>
      <label class="feld"><span>Startzeiten im Abstand von</span><select class="eingabe" data-einstell="true" data-einstell-field="slot_schritt">${[15, 30, 60].map((m) => `<option value="${m}" ${(einstell.slot_schritt ?? 30) === m ? "selected" : ""}>${m} Minuten</option>`).join("")}</select></label>
      <p class="hinweis">Beispiel: 90 Minuten Dauer und 30 Minuten Abstand ergibt 15:00, 15:30, 16:00 … – solange die ganze Dauer frei ist.</p>
      <label class="feld"><span>Vorlauf (Stunden)</span><input type="number" class="eingabe" value="${einstell.vorlauf_stunden}" min="0" step="1" data-einstell="true" data-einstell-field="vorlauf_stunden" /></label>
      <label class="feld"><span>Wie weit im Voraus buchbar (Tage)</span><input type="number" class="eingabe" value="${einstell.tage_voraus}" min="1" step="1" data-einstell="true" data-einstell-field="tage_voraus" /></label>
    </section>

    ${abschnittKalender()}
    ${abschnittBlocker()}`;
}

function abschnittKalender() {
  const pruefung = zustand.kalenderPruefung;
  const status = (k) => {
    if (!k.aktiv) return `<span class="kal-status">aus</span>`;
    if (!pruefung) return "";
    const s = pruefung.kalender?.[k.kalender_id];
    if (!s) return "";
    return s === "ok"
      ? `<span class="kal-status kal-status--ok">✓ Zugriff klappt</span>`
      : `<span class="kal-status kal-status--fehler">✗ nicht freigegeben</span>`;
  };
  const liste = [...daten.kalender].sort((a, b) => (a.art === b.art ? a.name.localeCompare(b.name) : a.art === "eintragen" ? -1 : 1));
  return `
    <section class="karte">
      <div class="karte__kopf">${kartenTitel("t-kalender", "himmel", "termin", "Kalender")}
        <button class="knopf knopf--klein knopf--voll" type="button" data-aktion="kalender-neu">+ Kalender hinzufügen</button>
      </div>
      <p class="hinweis">„Termine eintragen“: Dort landen bestätigte Termine. „Nur belegt lesen“: Wenn dort etwas steht, bieten wir keinen Termin an. Wir sehen dabei nur <em>dass</em> ihr beschäftigt seid, nicht was.</p>
      ${liste.length ? `<ul class="liste">${liste.map((k) => `<li class="kal-zeile">
        <span class="zeile__haupt">
          <span class="zeile__titel">${esc(k.name)}</span>
          <span class="zeile__unter kal-id">${esc(k.kalender_id)}</span>
          ${status(k)}
        </span>
        <select class="eingabe kal-art" data-kalender-art="${esc(k.id)}" aria-label="Was mit ${esc(k.name)} passiert">
          ${optionen([["eintragen", "Termine eintragen"], ["lesen", "Nur belegt lesen"]], k.art)}
        </select>
        <label class="kal-aktiv"><input type="checkbox" data-kalender-aktiv="${esc(k.id)}" ${k.aktiv ? "checked" : ""} /> aktiv</label>
        <button class="knopf knopf--klein knopf--leise" type="button" data-aktion="kalender-entfernen" data-id="${esc(k.id)}" aria-label="${esc(k.name)} entfernen">×</button>
      </li>`).join("")}</ul>` : `<p class="leer">Noch kein Kalender eingetragen.</p>`}
      <div class="kal-pruefen">
        <button class="knopf knopf--klein" type="button" data-aktion="kalender-pruefen">Zugriff prüfen</button>
        ${pruefung?.dienstkonto ? `<span class="leise">Freigeben für: <button class="kal-mail" type="button" data-aktion="kalender-mail-kopieren" data-wert="${esc(pruefung.dienstkonto)}">${esc(pruefung.dienstkonto)}</button></span>` : `<span class="leise">Zeigt auch die Adresse, für die ihr eure Kalender freigeben müsst.</span>`}
      </div>
    </section>`;
}

function abschnittBlocker() {
  const jetzt = new Date();
  const kommend = daten.blocker.filter((b) => new Date(b.bis) > jetzt).sort((a, b) => new Date(a.von) - new Date(b.von));
  const zeitraum = (b) => {
    const v = new Date(b.von), e = new Date(b.bis);
    const ganzTag = v.getHours() === 0 && v.getMinutes() === 0 && e.getHours() === 0 && e.getMinutes() === 0;
    if (ganzTag) {
      const letzterTag = new Date(e.getTime() - 1);
      return v.toDateString() === letzterTag.toDateString()
        ? `${fmtTag.format(v)} · ganztägig`
        : `${fmtTag.format(v)} – ${fmtTag.format(letzterTag)} · ganztägig`;
    }
    return v.toDateString() === e.toDateString()
      ? `${fmtTag.format(v)} · ${fmtUhr.format(v)}–${fmtUhr.format(e)} Uhr`
      : `${fmtTag.format(v)} ${fmtUhr.format(v)} – ${fmtTag.format(e)} ${fmtUhr.format(e)}`;
  };
  return `
    <section class="karte">
      <div class="karte__kopf">${kartenTitel("t-blocker", "bernstein", "sperre", "Blocker")}
        <button class="knopf knopf--klein knopf--voll" type="button" data-aktion="blocker-neu">+ Blocker</button>
      </div>
      <p class="hinweis">Zeiten, in denen ihr nicht könnt, z. B. Urlaub oder Klausur. Bleiben nur hier im Dashboard und stehen nicht im Google-Kalender.</p>
      ${kommend.length ? `<ul class="liste">${kommend.map((b) => `<li class="zeile">
        <span class="zeile__haupt"><span class="zeile__titel">${esc(b.grund || "Blocker")}</span><span class="zeile__unter">${zeitraum(b)}</span></span>
        ${personMarke(b.wer)}
        <button class="knopf knopf--klein knopf--leise" type="button" data-aktion="blocker-entfernen" data-id="${esc(b.id)}" aria-label="Blocker löschen">×</button>
      </li>`).join("")}</ul>` : `<p class="leer">Keine Blocker eingetragen.</p>`}
    </section>`;
}

function dialogKalender() {
  oeffneDialog({
    titel: "Kalender hinzufügen",
    knopf: "Hinzufügen",
    felder: `
      <label class="feld"><span>Name</span><input name="name" required placeholder="z. B. Louis privat" autocomplete="off" /></label>
      <label class="feld"><span>Kalender-ID</span><input name="kalender_id" required spellcheck="false" autocomplete="off" placeholder="name@gmail.com oder …@group.calendar.google.com" /></label>
      <p class="hinweis">Google Kalender → Einstellungen → euren Kalender anklicken → „Kalender integrieren“ → Kalender-ID. Beim Hauptkalender ist das einfach eure Gmail-Adresse.</p>
      <label class="feld"><span>Was soll passieren?</span><select name="art">${optionen([["lesen", "Nur belegt lesen (z. B. privater Kalender)"], ["eintragen", "Termine eintragen"]], "lesen")}</select></label>
      <p class="hinweis">Danach den Kalender in Google für das Dienstkonto freigeben (Adresse siehe „Zugriff prüfen“): zum Lesen reicht „Nur frei/beschäftigt sehen“, zum Eintragen „Änderungen an Terminen vornehmen“.</p>`,
    absenden: async (f) => {
      const kalenderId = f.kalender_id.replace(/\s/g, "");
      if (daten.kalender.some((k) => k.kalender_id === kalenderId)) throw new Error("Diesen Kalender gibt es schon.");
      // Es gibt nur einen Kalender zum Eintragen – der bisherige wird dann zum Lesen
      if (f.art === "eintragen") {
        for (const k of daten.kalender.filter((x) => x.art === "eintragen")) await aendern("kalender", k.id, { art: "lesen" });
      }
      await neu("kalender", { name: f.name.trim(), kalender_id: kalenderId, art: f.art, aktiv: true });
      zustand.kalenderPruefung = null;
    },
  });
}

function dialogBlocker() {
  const morgen = new Date();
  morgen.setDate(morgen.getDate() + 1);
  const tag = isoAusDatum(morgen);
  oeffneDialog({
    titel: "Blocker eintragen",
    felder: `
      <label class="feld"><span>Grund</span><input name="grund" placeholder="z. B. Urlaub, Klausur, Training" autocomplete="off" /></label>
      <label class="feld feld--check"><input type="checkbox" name="ganztag" checked data-blocker-ganztag /> <span>Ganztägig</span></label>
      <div class="feldreihe" data-blocker-tage>
        <label class="feld"><span>Von (Tag)</span><input name="von_tag" type="date" value="${tag}" /></label>
        <label class="feld"><span>Bis (Tag)</span><input name="bis_tag" type="date" value="${tag}" /></label>
      </div>
      <div class="feldreihe" data-blocker-zeiten hidden>
        <label class="feld"><span>Von</span><input name="von" type="datetime-local" value="${tag}T15:00" /></label>
        <label class="feld"><span>Bis</span><input name="bis" type="datetime-local" value="${tag}T17:00" /></label>
      </div>
      <label class="feld"><span>Wer kann nicht?</span><select name="wer">${optionen([["Beide", "Beide"], ["Louis", "Louis"], ["Lukas", "Lukas"]], "Beide")}</select></label>`,
    nachOeffnen: (form) => {
      const schalter = form.querySelector("[data-blocker-ganztag]");
      const umschalten = () => {
        form.querySelector("[data-blocker-tage]").hidden = !schalter.checked;
        form.querySelector("[data-blocker-zeiten]").hidden = schalter.checked;
      };
      schalter.addEventListener("change", umschalten);
      umschalten();
    },
    absenden: async (f) => {
      let von, bis;
      if (f.ganztag) {
        von = new Date(`${f.von_tag}T00:00`);
        bis = new Date(`${f.bis_tag || f.von_tag}T00:00`);
        bis.setDate(bis.getDate() + 1);
      } else {
        von = new Date(f.von);
        bis = new Date(f.bis);
      }
      if (!(bis > von)) throw new Error("„Bis“ muss nach „Von“ liegen.");
      await neu("blocker", { von: von.toISOString(), bis: bis.toISOString(), grund: f.grund.trim() || null, wer: f.wer });
    },
  });
}

/* ===================== Rendern und Navigation ===================== */

function route() {
  const [pfad, abfrage] = (location.hash.slice(1) || "uebersicht").split("?");
  const [bereich, id] = pfad.split("/");
  return { bereich, id, abfrage: new URLSearchParams(abfrage || "") };
}

let wartetAufRender = false;
let zeigeBeimRendern = null; // Kennzahl aus #geld?zeige=…: öffnet das Popup einmal beim Laden

function render() {
  if (!db) return;
  kanaeleLaden();
  const { bereich, id, abfrage } = route();
  if (bereich === "kunden" && abfrage.get("status")) {
    zustand.kundenFilter = abfrage.get("status");
    history.replaceState(null, "", "#kunden");
  }
  if (bereich === "geld" && abfrage.get("zeige")) {
    zeigeBeimRendern = abfrage.get("zeige");
    history.replaceState(null, "", "#geld");
  }
  const aktiv = document.activeElement;
  const fokusId = aktiv && aktiv.id;
  const cursor = fokusId && "selectionStart" in aktiv ? aktiv.selectionStart : null;

  const handy = istHandy();
  document.body.classList.toggle("handy", handy);
  const ansichten = { uebersicht: ansichtUebersicht, kunden: ansichtKunden, kunde: () => ansichtKunde(id), kalender: ansichtKalender, geld: ansichtGeld, aufgaben: ansichtAufgaben, zeiten: ansichtZeiten, einstellungen: ansichtEinstellungen, team: ansichtEinstellungen, mitarbeiter: () => ansichtMitarbeiter(id) };
  // Am Handy eigene Ansichten im Apple-Stil (handy.js)
  inhalt.innerHTML = handy && HANDY[bereich] ? HANDY[bereich](id, abfrage) : handy ? HANDY.uebersicht() : (ansichten[bereich] || ansichtUebersicht)();
  // Die Pille im Zeitraum-Schalter gleitet von der alten Stufe zur neuen
  const pille = $(".segment__pille", inhalt);
  if (pille) {
    pille.offsetWidth;
    pille.style.setProperty("--i", pille.dataset.ziel);
  }
  zustand.geldPillePrev = null;

  const navZiel = bereich === "kunde" ? "kunden" : bereich === "mitarbeiter" ? "einstellungen" : bereich;
  document.querySelectorAll("[data-nav] a").forEach((a) => {
    if (a.dataset.ziel === navZiel) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  const zeitenLink = $(".kopf__zeiten");
  if (bereich === "zeiten") zeitenLink.setAttribute("aria-current", "page");
  else zeitenLink.removeAttribute("aria-current");
  const einstLink = $(".kopf__einst");
  if (bereich === "einstellungen" || bereich === "mitarbeiter") einstLink.setAttribute("aria-current", "page");
  else einstLink.removeAttribute("aria-current");

  if (fokusId) {
    const wieder = document.getElementById(fokusId);
    if (wieder) {
      wieder.focus();
      if (cursor !== null) wieder.setSelectionRange(cursor, cursor);
    }
  }
  if (zeigeBeimRendern) {
    const zeige = zeigeBeimRendern;
    zeigeBeimRendern = null;
    oeffneDiagramm(zeige);
  }
  if (handy) hNachRender(bereich, id);
  wartetAufRender = false;
  anfragePopupPruefen();
}

// Änderungen vom anderen Gerät: nicht neu zeichnen, während jemand gerade tippt
function renderSpaeter() {
  const a = document.activeElement;
  const tipptGerade = a && inhalt.contains(a) && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName) && a.id !== "suche";
  if (tipptGerade || $("[data-dialog]").open || diagrammDialog.open || terminkarte.open) {
    wartetAufRender = true;
    return;
  }
  render();
}

inhalt.addEventListener("focusout", () => setTimeout(() => wartetAufRender && renderSpaeter(), 0));

window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
});

let toastZeit = 0;
function zeigeToast(text, dauer = 2600) {
  const t = $("[data-toast]");
  t.textContent = text;
  t.classList.add("ist-da");
  clearTimeout(toastZeit);
  toastZeit = setTimeout(() => t.classList.remove("ist-da"), dauer);
}

/* ===================== Dialoge ===================== */

const dialog = $("[data-dialog]");
const dialogForm = $("[data-dialog-form]");
let dialogAbsenden = null;

function oeffneDialog(einstellung, ohneHandy = false) {
  const { titel, felder, knopf = "Speichern", absenden, entfernen, nachOeffnen } = einstellung;
  dialogForm.classList.remove("hf");
  dialogForm.innerHTML = `
    <div class="dialog__kopf-handy">
      <button type="button" data-dialog-zu-handy>Abbrechen</button>
      <strong>${esc(titel)}</strong>
      <button type="submit">${esc(knopf === "Speichern" ? "Sichern" : knopf)}</button>
    </div>
    <h2>${esc(titel)}</h2>
    ${felder}
    <p class="meldung minus" data-dialog-fehler></p>
    <div class="dialog__fuss">
      ${entfernen ? `<button class="knopf knopf--leise knopf--gefahr" type="button" data-dialog-entfernen style="margin-right:auto">Löschen</button>` : ""}
      <button class="knopf knopf--leise" type="button" data-dialog-zu>Abbrechen</button>
      <button class="knopf knopf--voll" type="submit">${esc(knopf)}</button>
    </div>`;
  dialogAbsenden = absenden;
  $("[data-dialog-zu]", dialogForm).onclick = () => {
    dialog.close();
    karteZurueckOeffnen();
  };
  $("[data-dialog-zu-handy]", dialogForm).onclick = () => $("[data-dialog-zu]", dialogForm).click();
  if (entfernen) {
    $("[data-dialog-entfernen]", dialogForm).onclick = async () => {
      if (!confirm("Wirklich löschen? Das lässt sich nicht rückgängig machen.")) return;
      await entfernen();
      dialog.close();
      render();
      karteZurueckOeffnen();
    };
  }
  if (!dialog.open) dialog.showModal();
  nachOeffnen?.(dialogForm);
  if (istHandy() && !ohneHandy && !hFormular(dialogForm)) return oeffneDialog(einstellung, true);
  // Am Handy nicht sofort die Tastatur aufklappen
  if (!istHandy()) dialogForm.querySelector("input, select, textarea")?.focus();
}

dialogForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!dialogAbsenden) return;
  const knopf = dialogForm.querySelector("[type=submit]");
  knopf.disabled = true;
  try {
    if ((await dialogAbsenden(Object.fromEntries(new FormData(dialogForm).entries()), dialogForm)) === false) return;
    dialog.close();
    render();
    karteZurueckOeffnen();
  } catch (fehler) {
    $("[data-dialog-fehler]", dialogForm).textContent = fehler.message;
    $("[data-dialog-fehler]", dialogForm).scrollIntoView({ block: "center", behavior: "smooth" });
  } finally {
    knopf.disabled = false;
  }
});

dialog.addEventListener("close", () => wartetAufRender && render());

/* ===================== Diagramm-Popup (Geld) ===================== */

const diagrammDialog = $("[data-diagramm]");

let diagrammZeige = null;
function oeffneDiagramm(zeige) {
  diagrammZeige = zeige;
  const { titel, wert, diagramm } = diagrammFuer(zeige, aktuellerZeitraum(), zustand.geldStichtag);
  const mitWahl = aktuellerZeitraum() === "monat" && !["kasse", "hochrechnung"].includes(zeige);
  $("[data-diagramm-inhalt]", diagrammDialog).innerHTML = `
    <button class="diagramm-popup__zu" type="button" data-diagramm-zu aria-label="Schließen">×</button>
    <h2 class="diagramm-popup__titel" id="diagramm-titel">${esc(titel)}</h2>
    <div class="diagramm-popup__zeile"><p class="diagramm-popup__wert">${esc(wert)}</p>${mitWahl ? chartMonateWahl() : ""}</div>
    <div class="diagramm-popup__bild">${diagramm}</div>`;
  if (!diagrammDialog.open) diagrammDialog.showModal();
}

// Klick auf den Hintergrund (das Dialog-Element selbst) oder auf den Schließen-Knopf schließt
diagrammDialog.addEventListener("click", (e) => {
  if (e.target === diagrammDialog || e.target.closest("[data-diagramm-zu]")) return diagrammDialog.close();
  const wahl = e.target.closest("[data-chart-monate]");
  if (wahl) {
    chartMonateSetzen(wahl.dataset.chartMonate);
    return oeffneDiagramm(diagrammZeige);
  }
  const punkt = e.target.closest(".diagramm__punkt[data-tipp]");
  if (punkt) diagrammTippen(punkt);
  else diagrammDialog.querySelectorAll(".diagramm-tipp").forEach((t) => t.remove());
});

// Erstes Tippen: Blase mit Wert. Zweites Tippen auf denselben Punkt: Aufträge dieses Zeitraums
function diagrammTippen(punkt) {
  const svg = punkt.closest("svg");
  const box = svg.parentElement;
  const alt = $(".diagramm-tipp", box);
  if (alt && alt.dataset.fuer === punkt.dataset.tipp && punkt.dataset.von) {
    diagrammDialog.close();
    return auftraegeZeigen(new Date(punkt.dataset.von), new Date(punkt.dataset.bis), punkt.dataset.titel);
  }
  diagrammDialog.querySelectorAll(".diagramm-tipp").forEach((t) => t.remove());
  svg.querySelectorAll(".diagramm__punkt.ist-aktiv").forEach((p) => p.classList.remove("ist-aktiv"));
  punkt.classList.add("ist-aktiv");
  const tipp = document.createElement("div");
  tipp.className = "diagramm-tipp";
  tipp.dataset.fuer = punkt.dataset.tipp;
  tipp.innerHTML = `${esc(punkt.dataset.tipp)}${punkt.dataset.von ? `<small>Nochmal tippen: Aufträge ansehen</small>` : ""}`;
  box.style.position = "relative";
  box.appendChild(tipp);
  const sb = svg.getBoundingClientRect();
  const bb = box.getBoundingClientRect();
  const x = sb.left - bb.left + Number(punkt.dataset.x) * sb.width;
  const y = sb.top - bb.top + Number(punkt.dataset.y) * sb.height;
  const halb = tipp.offsetWidth / 2;
  tipp.style.left = `${Math.min(Math.max(x, halb + 4), bb.width - halb - 4)}px`;
  tipp.style.top = `${Math.max(y - 10, tipp.offsetHeight + 4)}px`;
}

function auftraegeZeigen(von, bis, titel) {
  zustand.kundenAnsicht = "auftraege";
  zustand.auftraegeZeitraum = { von, bis, titel };
  zustand.suche = "";
  if (location.hash === "#kunden") render();
  else location.hash = "#kunden";
}

const optionen = (liste, gewaehlt) =>
  liste.map((o) => {
    const [wert, name] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(wert)}"${String(wert) === String(gewaehlt ?? "") ? " selected" : ""}>${esc(name)}</option>`;
  }).join("");

function dialogKunde(k = {}) {
  oeffneDialog({
    titel: k.id ? "Kunde bearbeiten" : "Kunde anlegen",
    felder: `
      <label class="feld"><span>Name</span><input name="name" required value="${esc(k.name)}" autocomplete="off" /></label>
      <div class="feldreihe">
        <label class="feld"><span>Telefon</span><input name="telefon" type="tel" inputmode="tel" value="${esc(k.telefon)}" /></label>
        <label class="feld"><span>E-Mail</span><input name="email" type="email" spellcheck="false" value="${esc(k.email)}" /></label>
      </div>
      <label class="feld"><span>Straße und Hausnummer</span><input name="adresse" value="${esc(k.adresse)}" /></label>
      <label class="feld"><span>Status</span><select name="status">${optionen(STATUS.map((s) => [s.id, s.name]), k.status || "kontakt")}</select></label>
      ${kanalWahl(kanalAusKunde(k))}
      <label class="feld"><span>nebenan.de-Profil (optional)</span><input name="nebenan_link" type="text" inputmode="url" autocomplete="off" spellcheck="false" value="${esc(k.nebenan_link)}" placeholder="Link aus nebenan.de reinkopieren" /></label>
      <label class="feld"><span>Wie geht's weiter?</span><textarea name="weiter" rows="2">${esc(k.weiter)}</textarea></label>`,
    absenden: async (f) => {
      if (!k.id && !f.kanal) throw new Error("Bitte wähle, wie der Kunde auf uns zukam.");
      const zeile = { name: f.name.trim(), telefon: f.telefon.trim() || null, email: f.email.trim() || null, adresse: f.adresse.trim() || null, status: f.status, weiter: f.weiter.trim() || null, quelle: f.kanal || k.quelle || null, nebenan_link: f.nebenan_link.trim() || null };
      if (k.id) {
        if (k.status !== f.status) await notiz(k.id, `Status → ${STATUS_NAME[f.status]}`);
        await aendern("kunden", k.id, zeile);
      } else {
        const neuK = await neu("kunden", zeile);
        await notiz(neuK.id, "Kunde von Hand angelegt");
        location.hash = `#kunde/${neuK.id}`;
      }
    },
    // Löschen nur von Hand, z. B. bei einem Tippfehler – automatisch wird nie gelöscht
    entfernen: k.id
      ? async () => {
          await loeschen("kunden", k.id);
          location.hash = "#kunden";
        }
      : null,
  });
}

let dialogAuftragAktuell = {}; // für die Handy-Vorschau der Aufteilung
function dialogAuftrag(a = {}, kundeId = null) {
  dialogAuftragAktuell = a;
  const kid = a.kunde_id || kundeId;
  const kunden = [...daten.kunden].sort((x, y) => x.name.localeCompare(y.name, "de"));
  if (!kunden.length) {
    zeigeToast("Leg zuerst einen Kunden an.");
    return;
  }
  const leistung = a.leistung || "Fensterreinigung";
  const p = preise();
  const preisart = a.preisart || "stunden";
  oeffneDialog({
    titel: a.id ? "Auftrag bearbeiten" : "Neuer Auftrag",
    felder: `
      <label class="feld"><span>Kunde</span><select name="kunde_id" required>${optionen(kunden.map((k) => [k.id, k.name]), kid)}</select></label>
      <div class="feldreihe">
        <label class="feld"><span>Leistung</span><select name="leistung" data-leistung>${optionen(LEISTUNGEN, leistung)}</select></label>
        <label class="feld"><span>Termin</span><input name="datum" type="datetime-local" value="${esc(isoZuLokal(a.datum))}" /></label>
      </div>
      <div class="feldreihe" data-nur-fenster>
        <label class="feld"><span>Normale Fenster (${euro(p.preis_normal)})</span><input name="fenster_normal" type="number" inputmode="numeric" min="0" value="${esc(a.fenster_normal ?? 0)}" /></label>
        <label class="feld"><span>Bodentiefe Fenster (${euro(p.preis_boden)})</span><input name="fenster_boden" type="number" inputmode="numeric" min="0" value="${esc(a.fenster_boden ?? 0)}" /></label>
      </div>
      <fieldset class="feld preisart" data-nur-stunden>
        <legend>Abrechnung</legend>
        <div class="segment segment--preisart" role="radiogroup" aria-label="Abrechnung">
          <label class="segment__knopf"><input type="radio" name="preisart" value="stunden" ${preisart === "stunden" ? "checked" : ""} /><span>Stundenlohn</span></label>
          <label class="segment__knopf"><input type="radio" name="preisart" value="fest" ${preisart === "fest" ? "checked" : ""} /><span>Festpreis</span></label>
        </div>
      </fieldset>
      <div class="feldreihe" data-nur-stundenlohn>
        <label class="feld"><span>Stunden</span><input name="stunden" type="number" inputmode="decimal" min="0" step="0.25" value="${esc(a.stunden ?? "")}" /></label>
        <label class="feld"><span>Stundenlohn (€)</span><input name="stundensatz" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(a.stundensatz ?? p.stundensatz)}" /></label>
      </div>
      <div class="feldreihe" data-anfahrt-reihe>
        <label class="feld"><span>Anfahrt (€)</span><input name="anfahrt" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(a.anfahrt ?? "")}" placeholder="0" /></label>
        <label class="feld"><span>Geplante Dauer (Std.)</span><input name="dauer_plan" type="text" inputmode="decimal" value="${esc(stundenFeld(zahl(a.dauer_min)))}" data-dauer-plan /></label>
      </div>
      <div class="feldreihe">
        <label class="feld"><span data-geschaetzt-label>Geschätzter Preis (€)</span><input name="geschaetzt" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(a.geschaetzt ?? "")}" data-geschaetzt /></label>
        <label class="feld"><span>Wirklich bekommen (€)</span><input name="bekommen" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(a.bekommen ?? "")}" placeholder="nach dem Termin" /></label>
      </div>
      <p class="hinweis" data-schaetz-hinweis></p>
      <fieldset class="feld">
        <legend>Wer arbeitet mit?</legend>
        ${teamChips(teamVon(a))}
      </fieldset>
      <div class="feldreihe">
        <label class="feld"><span>Wirklich gebraucht (Std.)</span><input name="dauer_echt" type="text" inputmode="decimal" value="${esc(stundenFeld(zahl(a.dauer_echt_min)))}" placeholder="nach dem Termin" /></label>
      </div>
      ${prozenteFeld(a)}
      <p class="hinweis lohn-vorschau" data-lohn-vorschau></p>
      ${vorlaeufigSchalter(a)}
      <label class="feld"><span>Notizen zum Auftrag</span><textarea name="notiz" rows="3" placeholder="Zum Beispiel: Hund im Garten, Leiter mitbringen, Schlüssel beim Nachbarn">${esc(a.notiz)}</textarea></label>
      ${a.id ? `<label class="feld" style="grid-template-columns:auto 1fr;align-items:center;gap:.6rem"><input type="checkbox" name="abgesagt" ${a.abgesagt ? "checked" : ""} style="width:22px;min-height:22px" /><span>Abgesagt</span></label>` : ""}`,
    nachOeffnen: (form) => {
      const mitAnfahrt = (x, anf) => (x === null ? null : Math.round((x + (zahl(anf) || 0)) * 100) / 100);
      let vonHand = a.id && zahl(a.geschaetzt) !== null && zahl(a.geschaetzt) !== mitAnfahrt(schaetzen(a), a.anfahrt);
      const feld = $("[data-geschaetzt]", form);
      const aktualisieren = () => {
        const werte = Object.fromEntries(new FormData(form).entries());
        const fensterArt = werte.leistung === "Fensterreinigung";
        $("[data-nur-fenster]", form).hidden = !fensterArt;
        const fest = !fensterArt && werte.preisart === "fest";
        $("[data-nur-stunden]", form).hidden = fensterArt;
        $("[data-nur-stundenlohn]", form).hidden = fensterArt || fest;
        $("[data-geschaetzt-label]", form).textContent = fest ? "Festpreis (€)" : "Geschätzter Preis (€)";
        const anf = zahl(werte.anfahrt);
        const s = mitAnfahrt(schaetzen(werte), anf);
        const satz = zahl(werte.stundensatz) ?? p.stundensatz;
        $("[data-schaetz-hinweis]", form).textContent = fest
          ? "Festpreis: Betrag oben direkt eintragen."
          : s === null ? "" : `Rechnung: ${fensterArt ? `${werte.fenster_normal || 0} × ${euro(p.preis_normal)} + ${werte.fenster_boden || 0} × ${euro(p.preis_boden)}, mindestens ${euro(p.mindestpreis)}` : `${Number(werte.stunden).toLocaleString("de-DE")} h × ${euro(satz)}`}${anf ? ` + ${euro(anf)} Anfahrt` : ""} = ${euro(s)}`;
        // Geplante Dauer: leer = automatisch nach Auftragsgröße
        const auto = dauerSchaetzung({ ...werte, dauer_min: null, stunden: fensterArt || fest ? null : zahl(werte.stunden), geschaetzt: zahl(werte.bekommen) === null ? (vonHand ? zahl(feld.value) : s) : null, bekommen: zahl(werte.bekommen), anfahrt: anf });
        $("[data-dauer-plan]", form).placeholder = `automatisch ${stundenFeld(auto)}`;
        if (!vonHand && s !== null) feld.value = s;
        const betrag = zahl(werte.bekommen) ?? zahl(feld.value);
        const teil = lohnAufteilung({ bekommen: betrag, team: teamAusForm(form), ...prozenteAusForm(form, a) });
        $("[data-lohn-vorschau]", form).innerHTML = `${zahl(werte.bekommen) === null ? "Bei " + euro(betrag || 0) + ": " : ""}${aufteilungText(teil, betrag)}`;
      };
      feld.addEventListener("input", () => (vonHand = true));
      prozenteEinrichten(form, a);
      form.addEventListener("input", (e) => e.target !== feld && aktualisieren());
      form.addEventListener("change", aktualisieren);
      aktualisieren();
    },
    absenden: async (f, form) => {
      const team = teamAusForm(form);
      if (!team.length) throw new Error("Bitte ankreuzen, wer mitarbeitet.");
      const fensterArt = f.leistung === "Fensterreinigung";
      const zeile = {
        kunde_id: f.kunde_id,
        leistung: f.leistung,
        datum: lokalZuIso(f.datum),
        fenster_normal: fensterArt ? Number(f.fenster_normal) || 0 : 0,
        fenster_boden: fensterArt ? Number(f.fenster_boden) || 0 : 0,
        stunden: fensterArt || f.preisart === "fest" ? null : zahl(f.stunden),
        preisart: fensterArt ? "stunden" : f.preisart || "stunden",
        stundensatz: fensterArt || f.preisart === "fest" ? null : zahl(f.stundensatz),
        geschaetzt: zahl(f.geschaetzt),
        bekommen: zahl(f.bekommen),
        anfahrt: zahl(f.anfahrt),
        dauer_min: minutenAus(f.dauer_plan),
        abgesagt: Boolean(f.abgesagt),
        // Woher der Kunde kommt, steht seit v18 nur noch beim Kunden
        kanal: a.kanal || kanalAusKunde(kundeVon(f.kunde_id)),
        vorlaeufig: Boolean(f.vorlaeufig) && Boolean(f.datum),
        notiz: (f.notiz || "").trim() || null,
        team,
        ...prozenteSpeichern(form, a, team),
        dauer_echt_min: minutenAus(f.dauer_echt),
      };
      let gespeichert;
      if (a.id) {
        gespeichert = await aendern("auftraege", a.id, zeile);
        if (zahl(a.bekommen) === null && zeile.bekommen !== null) await nachBezahlung(zeile.kunde_id, zeile);
        else if (zeile.datum && (!gleicheZeit(zeile.datum, a.datum) || zeile.vorlaeufig !== Boolean(a.vorlaeufig))) await statusNachTermin(zeile.kunde_id, zeile);
      } else {
        gespeichert = await neu("auftraege", zeile);
        if (zeile.bekommen !== null) await nachBezahlung(zeile.kunde_id, zeile);
        else await statusNachTermin(zeile.kunde_id, zeile);
      }
      const id = gespeichert?.id || a.id;
      await lohnBuchen({ ...zeile, id });
      kalenderAbgleichen(id);
    },
    entfernen: a.id ? () => auftragLoeschen(a) : null,
  });
}

// Nur speichern, was vom Standard abweicht oder schon fest im Auftrag steht –
// sonst gelten weiter die Einstellungen (beim Bezahlen werden sie festgehalten)
function prozenteSpeichern(form, a, team) {
  const p = prozenteAusForm(form, a);
  const einzeln = {};
  team.filter((n) => !PERSONEN.includes(n)).forEach((n) => {
    if (p.einzeln[n] !== prozentVon(a) || zahl(a.mitarbeiter_prozent?.[n]) !== null) einzeln[n] = p.einzeln[n];
  });
  const zeile = { mitarbeiter_prozent: Object.keys(einzeln).length ? einzeln : null };
  if (zahl(a.allein_prozent) !== null || p.allein !== alleinStandard()) zeile.allein_prozent = p.allein;
  if (zahl(a.louis_prozent) !== null || p.louis !== louisStandard()) zeile.louis_prozent = p.louis;
  return zeile;
}

// Schalter „Noch nicht bestätigt“: ungefähr ausgemacht, steht aber noch nicht fest
function vorlaeufigSchalter(a) {
  return `<label class="schalter-zeile">
    <input type="checkbox" name="vorlaeufig" ${a.vorlaeufig ? "checked" : ""} />
    <span><b>Noch nicht bestätigt</b><small>Ungefähr ausgemacht, z. B. „wahrscheinlich Samstag 16 Uhr“. Steht als „Termin geplant“ und mit ? im Kalender.</small></span>
  </label>`;
}

// Gleicher Zeitpunkt, egal wie das Datum geschrieben ist (DB: +00:00, Formular: Z)
const gleicheZeit = (x, y) => (x ? new Date(x).getTime() : null) === (y ? new Date(y).getTime() : null);

// Status kommt immer aus den Aufträgen:
// – fester Termin offen (Datum, nicht vorläufig, nicht nur angefragt) → „Termin steht“
// – Auftrag ohne Datum, vorläufig oder angefragt → „Termin geplant“ (frische Website-Anfrage bleibt „Neu“)
// – sonst bezahlt → „Erledigt“, ab STAMM_AB bezahlten Besuchen „Stammkunde“ (bleibt dann Stammkunde)
// – nichts mehr offen und nie bezahlt → „Kontakt“ bzw. „Abgesagt“, „Neu“/„Kontakt“ bleiben von Hand
function statusSoll(k) {
  const alle = auftraegeVon(k.id);
  const jetzt = new Date();
  const offen = alle.filter(
    (a) =>
      !a.abgesagt &&
      a.termin_status !== "abgelehnt" &&
      zahl(a.bekommen) === null &&
      // Vergangene Besichtigung o. Ä. (ohne Geld) ist vorbei
      !(istTermin(a) && a.datum && new Date(a.datum) < jetzt) &&
      // Website-Anfrage ohne Wunschtermin ist noch kein Termin (kein Team = vom Formular angelegt)
      !(!istTermin(a) && !a.datum && !Array.isArray(a.team))
  );
  const istFest = (a) => a.datum && !a.vorlaeufig && a.termin_status !== "angefragt";
  const bezahlt = alle.filter((a) => !istTermin(a) && zahl(a.bekommen) !== null).length;
  if (k.status === "stamm" || bezahlt >= STAMM_AB) return "stamm";
  if (offen.some(istFest)) return "termin";
  if (offen.length) return k.status === "neu" && offen.every((a) => a.termin_status === "angefragt") ? "neu" : "geplant";
  if (bezahlt) return "erledigt";
  if (["geplant", "termin", "erledigt"].includes(k.status))
    return alle.some((a) => a.abgesagt || a.termin_status === "abgelehnt") ? "abgesagt" : "kontakt";
  return k.status;
}

async function statusAbgleichen(kundeId, { abgesagtLassen = false } = {}) {
  const k = kundeVon(kundeId);
  if (!k) return;
  if (abgesagtLassen && k.status === "abgesagt") return;
  const ziel = statusSoll(k);
  if (!ziel || ziel === k.status) return;
  await aendern("kunden", k.id, { status: ziel });
  const besuche = auftraegeVon(k.id).filter((a) => !istTermin(a) && zahl(a.bekommen) !== null).length;
  await notiz(k.id, `Status → ${STATUS_NAME[ziel]}${ziel === "stamm" ? ` (${besuche}. Besuch)` : ""}`);
}

// Beim Start einmal alles geraderücken (von Hand auf „Abgesagt“ gesetzte Kunden bleiben)
async function statusAlleAbgleichen() {
  for (const k of [...daten.kunden]) await statusAbgleichen(k.id, { abgesagtLassen: true });
}

// Alte Aufrufe: Status einfach neu berechnen
async function statusNachTermin(kundeId) {
  await statusAbgleichen(kundeId);
}

// Google-Kalender „Klar Glas“ nachziehen: eintragen, verschieben oder austragen. Fehler stören das Speichern nicht.
async function kalenderAbgleichen(id, aktion = "abgleichen") {
  if (!id || db.lokal) return;
  // Ohne Datum und ohne Kalendereintrag gibt es nichts abzugleichen
  const a = daten.auftraege.find((x) => x.id === id);
  if (a && !a.datum && !a.google_event_id) return;
  try {
    await terminAktion(id, aktion);
    renderSpaeter();
  } catch (e) {
    zeigeToast(`Gespeichert, aber der Kalender hat nicht geklappt: ${e.message}`, 7000);
  }
}

async function auftragLoeschen(a) {
  if (a.google_event_id) await kalenderAbgleichen(a.id, "austragen");
  await loeschen("auftraege", a.id);
}

// Mitarbeiter anlegen oder umbenennen; beim Umbenennen ziehen Aufträge und Löhne mit
// Eigenen Kontaktweg anlegen, z. B. eine Werbeaktion
function dialogKanal() {
  const frei = KANAL_FARBEN.find((f) => !Object.values(KANAELE).some((k) => k.farbe.toLowerCase() === f.toLowerCase())) || KANAL_FARBEN[0];
  oeffneDialog({
    titel: "Neuer Kontaktweg",
    knopf: "Hinzufügen",
    felder: `<label class="feld"><span>Name</span><input name="name" required autocomplete="off" maxlength="24" placeholder="z. B. Flyer Märchenviertel" /></label>
      <fieldset class="feld kanal-farben"><legend>Farbe</legend><div class="kanal-farben__reihe">
        ${KANAL_FARBEN.map((f) => `<label class="kanal-farben__punkt" style="--c:${f}"><input type="radio" name="farbe" value="${f}"${f === frei ? " checked" : ""} /><span class="visually-hidden">${f}</span></label>`).join("")}
      </div></fieldset>
      <p class="hinweis">Taucht dann bei „Kontakt über“ in Auftrag und Kunde auf.</p>`,
    absenden: async (f) => {
      const name = (f.name || "").trim();
      if (!name) throw new Error("Bitte einen Namen eingeben.");
      const gleich = Object.entries(KANAELE).find(([, k]) => k.name.toLowerCase() === name.toLowerCase());
      const liste = eigeneKanaele().map((k) => ({ ...k }));
      if (gleich && !KANAELE[gleich[0]].aus) throw new Error(`„${name}“ gibt es schon.`);
      if (gleich) liste.find((k) => k.id === gleich[0]).aus = false;
      else liste.push({ id: `k_${Date.now().toString(36)}`, name, farbe: f.farbe || frei });
      await aendern("einstellungen", daten.einstellungen[0]?.id ?? 1, { kanaele: liste });
      zeigeToast(`${name} ist dabei`);
    },
  });
}

async function kanalEntfernen(id) {
  const k = KANAELE[id];
  if (!k?.eigen || !confirm(`„${k.name}“ entfernen? Alte Aufträge behalten ihn.`)) return;
  const liste = eigeneKanaele().map((x) => (x.id === id ? { ...x, aus: true } : x));
  await aendern("einstellungen", daten.einstellungen[0]?.id ?? 1, { kanaele: liste });
}

function dialogMitarbeiter(m = {}) {
  oeffneDialog({
    titel: m.id ? `${m.name} umbenennen` : "Mitarbeiter hinzufügen",
    felder: `<label class="feld"><span>Name</span><input name="name" required autocomplete="off" value="${esc(m.name || "")}" placeholder="z. B. Flo" /></label>
      ${m.id ? "" : `<p class="hinweis">Taucht dann bei „Wer arbeitet mit?“ auf. Anteil: ${esc(standardAnteil())} % pro Auftrag.</p>`}`,
    absenden: async (f) => {
      const name = (f.name || "").trim();
      if (!name) throw new Error("Bitte einen Namen eingeben.");
      if ([...PERSONEN, "Beide", "Kasse"].includes(name) || daten.mitarbeiter.some((x) => x.name === name && x.id !== m.id)) throw new Error(`„${name}“ gibt es schon.`);
      if (!m.id) {
        await neu("mitarbeiter", { name, aktiv: true });
        zeigeToast(`${name} ist im Team`);
        return;
      }
      if (name === m.name) return;
      await aendern("mitarbeiter", m.id, { name });
      for (const a of daten.auftraege.filter((x) => x.team?.includes(m.name))) {
        await db.update("auftraege", a.id, { team: a.team.map((n) => (n === m.name ? name : n)) });
      }
      for (const x of daten.auszahlungen.filter((y) => y.an === m.name)) await db.update("auszahlungen", x.id, { an: name });
      await Promise.all(["auftraege", "auszahlungen"].map(laden));
      if (route().bereich === "mitarbeiter") history.replaceState(null, "", `#mitarbeiter/${encodeURIComponent(name)}`);
    },
  });
}

// Termin ohne Geld: Besichtigung, Rückruf … Kunde ist freiwillig
function dialogTermin(a = {}, kundeId = null) {
  const kid = a.kunde_id || kundeId;
  const kunden = [...daten.kunden].sort((x, y) => x.name.localeCompare(y.name, "de"));
  const art = a.titel && !TERMIN_ARTEN.includes(a.titel) ? "Sonstiges" : a.titel || "Besichtigung";
  oeffneDialog({
    titel: a.id ? "Termin bearbeiten" : "Neuer Termin",
    felder: `
      <p class="hinweis">Ein Termin bringt kein Geld, z. B. eine Besichtigung. Er steht im Kalender, aber nicht bei Geld.</p>
      <fieldset class="feld">
        <legend>Was für ein Termin?</legend>
        <div class="chips chips--wahl">${TERMIN_ARTEN.map((t) => `<label class="chip chip--wahl"><input type="radio" name="art_wahl" value="${esc(t)}"${t === art ? " checked" : ""} />${esc(t)}</label>`).join("")}</div>
      </fieldset>
      <label class="feld" data-eigener-titel ${art === "Sonstiges" ? "" : "hidden"}><span>Titel</span><input name="eigener_titel" value="${esc(art === "Sonstiges" && a.titel !== "Sonstiges" ? a.titel || "" : "")}" placeholder="Zum Beispiel: Angebot vorbeibringen" /></label>
      <label class="feld"><span>Kunde (optional)</span><select name="kunde_id"><option value="">–</option>${optionen(kunden.map((k) => [k.id, k.name]), kid)}</select></label>
      <div class="feldreihe">
        <label class="feld"><span>Wann</span><input name="datum" type="datetime-local" required value="${esc(isoZuLokal(a.datum))}" /></label>
        <label class="feld"><span>Dauer</span><select name="dauer_min">${optionen([[15, "15 Min."], [30, "30 Min."], [45, "45 Min."], [60, "1 Std."], [90, "1,5 Std."], [120, "2 Std."]], a.dauer_min || 30)}</select></label>
      </div>
      ${vorlaeufigSchalter(a)}
      <label class="feld"><span>Notizen</span><textarea name="notiz" rows="3" placeholder="Zum Beispiel: Wintergarten anschauen, Fotos machen">${esc(a.notiz)}</textarea></label>
      ${a.id ? `<label class="feld" style="grid-template-columns:auto 1fr;align-items:center;gap:.6rem"><input type="checkbox" name="abgesagt" ${a.abgesagt ? "checked" : ""} style="width:22px;min-height:22px" /><span>Abgesagt</span></label>` : ""}`,
    nachOeffnen: (form) => {
      form.addEventListener("change", () => {
        $("[data-eigener-titel]", form).hidden = new FormData(form).get("art_wahl") !== "Sonstiges";
      });
    },
    absenden: async (f) => {
      const titel = f.art_wahl === "Sonstiges" ? f.eigener_titel.trim() || "Termin" : f.art_wahl;
      const zeile = {
        art: "termin",
        titel,
        leistung: titel,
        kunde_id: f.kunde_id || null,
        datum: lokalZuIso(f.datum),
        dauer_min: Number(f.dauer_min) || 30,
        vorlaeufig: Boolean(f.vorlaeufig),
        notiz: f.notiz.trim() || null,
        abgesagt: Boolean(f.abgesagt),
        fenster_normal: 0,
        fenster_boden: 0,
      };
      let gespeichert;
      if (a.id) gespeichert = await aendern("auftraege", a.id, zeile);
      else {
        gespeichert = await neu("auftraege", zeile);
        if (zeile.kunde_id) await notiz(zeile.kunde_id, `${titel} am ${fmtTag.format(new Date(zeile.datum))}, ${fmtUhr.format(new Date(zeile.datum))} Uhr eingetragen${zeile.vorlaeufig ? " (vorläufig)" : ""}`);
      }
      if (zeile.kunde_id && (!a.id || !gleicheZeit(zeile.datum, a.datum) || zeile.vorlaeufig !== Boolean(a.vorlaeufig))) await statusNachTermin(zeile.kunde_id, zeile);
      kalenderAbgleichen(gespeichert?.id || a.id);
    },
    entfernen: a.id ? () => auftragLoeschen(a) : null,
  });
}

// Nach dem Kassieren: Status auf „Erledigt“ und Verlauf ergänzen
async function nachBezahlung(kundeId, auftrag) {
  const k = kundeVon(kundeId);
  const tg = trinkgeld(auftrag);
  await notiz(kundeId, `${auftrag.leistung} erledigt · ${euro(auftrag.bekommen)} bekommen${tg ? ` (davon ${euro(tg)} Trinkgeld)` : ""}`);
  if (!k) return;
  // Erledigt / ab STAMM_AB bezahlten Besuchen Stammkunde
  await statusAbgleichen(kundeId);
}

function dialogAusgabe(x = {}) {
  oeffneDialog({
    titel: x.id ? "Ausgabe bearbeiten" : "Ausgabe eintragen",
    felder: `
      <div class="feldreihe">
        <label class="feld"><span>Betrag (€)</span><input name="betrag" type="number" inputmode="decimal" min="0" step="0.01" required value="${esc(x.betrag ?? "")}" /></label>
        <label class="feld"><span>Datum</span><input name="datum" type="date" required value="${esc(x.datum || heuteIso())}" /></label>
      </div>
      <div class="feldreihe">
        <label class="feld"><span>Wofür</span><select name="kategorie">${optionen(KATEGORIEN, x.kategorie)}</select></label>
        <label class="feld"><span>Bezahlt von</span><select name="bezahlt_von">${optionen([["Kasse", "Unternehmenskasse"], ...PERSONEN.map((p) => [p, `${p} (privat, kommt aufs Konto)`])], x.bezahlt_von || "Kasse")}</select></label>
      </div>
      <label class="feld"><span>Notiz</span><input name="notiz" value="${esc(x.notiz)}" placeholder="Zum Beispiel: neuer Abzieher" /></label>`,
    absenden: async (f) => {
      const zeile = { betrag: Number(f.betrag), datum: f.datum, kategorie: f.kategorie, bezahlt_von: f.bezahlt_von, notiz: f.notiz.trim() || null };
      if (x.id) await aendern("ausgaben", x.id, zeile);
      else await neu("ausgaben", zeile);
    },
    entfernen: x.id ? () => loeschen("ausgaben", x.id) : null,
  });
}

function dialogAuszahlung(x = {}) {
  oeffneDialog({
    titel: x.id ? "Auszahlung bearbeiten" : "Auszahlung vom Konto",
    felder: `
      <div class="feldreihe">
        <label class="feld"><span>Betrag (€)</span><input name="betrag" type="number" inputmode="decimal" min="0" step="0.01" required value="${esc(x.betrag ?? "")}" /></label>
        <label class="feld"><span>Datum</span><input name="datum" type="date" required value="${esc(x.datum || heuteIso())}" /></label>
      </div>
      <label class="feld"><span>An</span><select name="an">${optionen([...PERSONEN, ["Beide", "Louis und Lukas (je die Hälfte)"]], x.an || ich)}</select></label>
      <label class="feld"><span>Notiz</span><input name="notiz" value="${esc(x.notiz)}" /></label>
      <p class="hinweis" data-konto-hinweis></p>`,
    nachOeffnen: (form) => {
      const zeigen = () => {
        const an = form.elements.an.value;
        const teil = an === "Beide" ? konten().map((p) => `${p.name} ${euro(p.guthaben)}`).join(" · ") : `${an}s Konto: ${euro(guthabenVon(an) + (x.id && x.an === an ? Number(x.betrag) : 0))}`;
        const ziel = $("[data-konto-hinweis]", form);
        if (ziel) ziel.textContent = `${teil} · Kasse gesamt ${euro(kassenstand())}`;
      };
      form.elements.an.addEventListener("change", zeigen);
      zeigen();
    },
    absenden: async (f) => {
      const zeile = { betrag: Number(f.betrag), datum: f.datum, an: f.an, notiz: f.notiz.trim() || null };
      const frei = f.an === "Beide" ? Math.min(...konten().map((p) => p.guthaben)) * 2 : guthabenVon(f.an) + (x.id && x.an === f.an ? Number(x.betrag) : 0);
      if (zeile.betrag > frei + 0.004 && !confirm(`Das ist mehr als auf dem Konto (${euro(frei)}). Trotzdem auszahlen?`)) return false;
      if (x.id) await aendern("auszahlungen", x.id, zeile);
      else await neu("auszahlungen", { ...zeile, art: "anteil" });
    },
    entfernen: x.id ? () => loeschen("auszahlungen", x.id) : null,
  });
}

const VORLAUF = [[0, "Pünktlich"], [15, "15 min vorher"], [60, "1 Std vorher"], [1440, "1 Tag vorher"]];
const vorlaufText = (m) => (VORLAUF.find(([w]) => w === Number(m)) || VORLAUF[0])[1];

function dialogAufgabe(a = {}) {
  const kunden = [...daten.kunden].sort((x, y) => x.name.localeCompare(y.name, "de"));
  oeffneDialog({
    titel: a.id ? "Aufgabe bearbeiten" : "Neue Aufgabe",
    felder: `
      <label class="feld"><span>Was ist zu tun?</span><input name="titel" required value="${esc(a.titel)}" placeholder="Zum Beispiel: Am Mittwoch bei Familie X melden" /></label>
      <div class="feldreihe">
        <label class="feld"><span>Wer</span><select name="zustaendig">${optionen(["Beide", ...PERSONEN], a.zustaendig || "Beide")}</select></label>
        <label class="feld"><span>Wann</span><input name="faellig" type="date" value="${esc(a.faellig || "")}" /></label>
        <label class="feld"><span>Uhrzeit</span><input name="uhrzeit" type="time" value="${esc((a.uhrzeit || "").slice(0, 5))}" /></label>
      </div>
      <label class="schalter-zeile" data-push-zeile>
        <input type="checkbox" name="push" ${a.push ? "checked" : ""} />
        <span><b>🔔 Push-Erinnerung</b><small>Kommt aufs Handy von ${a.zustaendig && a.zustaendig !== "Beide" ? esc(a.zustaendig) : "euch beiden"}. Ohne Uhrzeit um 16 Uhr.</small></span>
      </label>
      <label class="feld" data-vorlauf><span>Erinnern</span><select name="vorlauf_min">${optionen(VORLAUF.map(([w, t]) => [String(w), t]), String(a.vorlauf_min ?? 0))}</select></label>
      <label class="feld"><span>Zu Kunde (optional)</span><select name="kunde_id"><option value="">–</option>${optionen(kunden.map((k) => [k.id, k.name]), a.kunde_id)}</select></label>`,
    nachOeffnen: (form) => {
      const zeigen = () => {
        const v = form.querySelector("[data-vorlauf]");
        if (v) v.hidden = !form.elements.push.checked;
      };
      form.addEventListener("change", zeigen);
      zeigen();
    },
    absenden: async (f) => {
      const push = Boolean(f.push);
      if (push && !f.faellig) throw new Error("Für die Push-Erinnerung bitte einen Tag wählen.");
      const zeile = {
        titel: f.titel.trim(),
        zustaendig: f.zustaendig,
        faellig: f.faellig || null,
        uhrzeit: f.uhrzeit || (push ? "16:00" : null),
        push,
        vorlauf_min: Number(f.vorlauf_min) || 0,
        kunde_id: f.kunde_id || null,
      };
      // Zeit geändert → Erinnerung darf noch einmal kommen
      if (!a.id || zeile.faellig !== a.faellig || zeile.uhrzeit !== (a.uhrzeit || "").slice(0, 5) || zeile.vorlauf_min !== (a.vorlauf_min ?? 0) || zeile.zustaendig !== a.zustaendig) zeile.push_gesendet = null;
      if (a.id) await aendern("aufgaben", a.id, zeile);
      else await neu("aufgaben", { ...zeile, erledigt: false });
    },
    entfernen: a.id ? () => loeschen("aufgaben", a.id) : null,
  });
}

/* ===================== Terminkarte ===================== */

const terminkarte = $("[data-terminkarte]");
let terminkarteId = null;
let zurueckZurKarte = null; // Auftrag, der aus der Karte heraus bearbeitet wird: danach geht die Karte wieder auf

const TK_ICON = {
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  fenster: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M12 4v16M4 12h16"/>',
  haken: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};

// Betrag aus dem Feld lesen: Komma oder Punkt, Euro-Zeichen egal
const betragLesen = (text) => {
  const s = String(text ?? "").replace(/[€\s]/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

// Wer arbeitet mit? Chips zum Ankreuzen: Louis, Lukas, aktive Mitarbeiter (+ alte Namen aus dem Auftrag)
function teamChips(team) {
  const namen = [...PERSONEN, ...aktiveMitarbeiter().map((m) => m.name)];
  team.forEach((n) => !namen.includes(n) && namen.push(n));
  return `<div class="chips chips--wahl team-chips">${namen
    .map((n) => `<label class="chip chip--wahl"><input type="checkbox" name="team" value="${esc(n)}"${team.includes(n) ? " checked" : ""} />${esc(n)}</label>`)
    .join("")}</div>`;
}
const teamAusForm = (form) => [...form.querySelectorAll('input[name="team"]:checked')].map((x) => x.value);

// Stunden als Text („1,5“) ↔ Minuten
const stundenFeld = (min) => (min ? String(Math.round((min / 60) * 100) / 100).replace(".", ",") : "");
const minutenAus = (text) => {
  const h = betragLesen(text);
  return h ? Math.round(h * 60) : null;
};

// Trinkgeld-Hinweis unter dem Betragsfeld, live beim Tippen
function tgTextFuer(betrag, geschaetzt) {
  if (betrag === null) return "";
  const tg = geschaetzt > 0 ? Math.max(0, Math.round((betrag - geschaetzt) * 100) / 100) : 0;
  const prozent = geschaetzt > 0 ? Math.round((tg / geschaetzt) * 100) : null;
  return `davon Trinkgeld: <strong>${euro(tg)}</strong>${prozent !== null ? ` (${prozent} %)` : ""}`;
}

// Runder Schnellknopf: Kreis mit Icon, Beschriftung darunter
const tkKreis = (farbe, icon, titel) => `<span class="tk-rund__kreis tk-rund__kreis--${farbe}" aria-hidden="true"><svg viewBox="0 0 24 24">${icon}</svg></span><span class="tk-rund__titel">${titel}</span>`;

// Initialen für den Avatar-Kreis: "Anna Müller" wird "AM"
const tkInitialen = (name) =>
  String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase();

// Schnellknopf: fehlt die Angabe, bleibt er sichtbar, ist aber ausgegraut und nicht anklickbar
const tkSchnell = (ok, href, farbe, icon, titel, attr = "") =>
  ok
    ? `<a class="tk-rund" href="${esc(href)}"${attr}>${tkKreis(farbe, icon, titel)}</a>`
    : `<span class="tk-rund tk-rund--aus" aria-disabled="true" aria-label="${titel}: keine Angabe" title="${titel}: keine Angabe">${tkKreis("aus", icon, titel)}</span>`;

// ---------- Terminkarte (Design B): Personenkarte, Statusleiste, Kacheln, Erledigt-Pop-up ----------
const TB_ICON = {
  route: '<path d="M3 11l19-9-9 19-2-8-8-2z"/>',
  pfeil: '<path d="m9 18 6-6-6-6"/>',
  notiz: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  team: '<path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3.5"/><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.6a3.5 3.5 0 0 1 0 6.8"/>',
};
const tbSvg = (pfad) => `<svg viewBox="0 0 24 24" aria-hidden="true">${pfad}</svg>`;
const fmtTbTag = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short" });
const tbDauer = (min) => {
  const h = Math.floor(min / 60);
  const r = Math.round(min % 60);
  return [h && `${h} Std`, r && `${r} min`].filter(Boolean).join(" ") || "0 min";
};
// Kurz für enge Kacheln: 1:45 h / 45 min
const tbDauerKurz = (min) => (min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")} h`);
const tbTage = (d) => {
  const j = new Date();
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(j.getFullYear(), j.getMonth(), j.getDate())) / 86400000);
};

// Stundenlohn pro Person: alles inkl. Trinkgeld ÷ Leute ÷ Stunden
function stundenlohnProPerson(bekommen, team, min) {
  if (!min || bekommen === null || !team.length) return null;
  return Math.round((bekommen / team.length / (min / 60)) * 100) / 100;
}

// Phase für die Statusleiste: 0 angefragt, 1 geplant, 2 erledigt (Geld fehlt), 3 bezahlt
function tbPhase(a, d) {
  if (zahl(a.bekommen) !== null) return 3;
  if (a.termin_status === "angefragt") return 0;
  if (d && d < new Date() && !a.vorlaeufig) return 2;
  return 1;
}

// Schwarzer Kassenblock nach dem Termin: Betrag, Aufteilung, Stundenlohn
function tbKasse(a, erfolg) {
  const b = zahl(a.bekommen);
  const g = zahl(a.geschaetzt);
  const team = teamVon(a);
  const teil = kontoAufteilung({ ...a, bekommen: b, team });
  const diff = g !== null ? Math.round((b - g) * 100) / 100 : null;
  const diffText = diff === null ? "" : diff === 0 ? "genau wie geschätzt" : `${diff > 0 ? "+" : "−"}${euro(Math.abs(diff))} ${diff > 0 ? "über" : "unter"} Schätzung`;
  const teile = [...teil.loehne.map((l) => ({ name: `${l.name} bar`, betrag: l.betrag, farbe: hfFarbe(l.name) })), ...PERSONEN.map((p) => ({ name: p, betrag: teil.konto[p], farbe: hfFarbe(p) }))].filter((t) => t.betrag > 0);
  const lohn = stundenlohnProPerson(b, team, zahl(a.dauer_echt_min));
  const tg = trinkgeld(a);
  return `<section class="tb-kasse tb-breit${erfolg ? " tb-kasse--neu" : ""}" aria-label="Bekommen">
      <div class="tb-kasse__zeile"><span class="tb-kasse__klein">Bekommen</span><button class="tb-kasse__aendern" type="button" data-tb-eintragen>Ändern</button></div>
      <p class="tb-kasse__betrag">${euro(b)}</p>
      ${diffText ? `<p class="tb-kasse__diff${diff > 0 ? " plus" : diff < 0 ? " minus" : ""}">${diffText}</p>` : ""}
      ${teile.length > 1 ? `<div class="tb-split" aria-hidden="true">${teile.map((t) => `<i style="flex:${t.betrag};background:${t.farbe}"></i>`).join("")}</div>` : ""}
      <div class="tb-legende">${teile.map((t) => `<span style="--c:${t.farbe}">${esc(t.name)} ${euro(t.betrag)}</span>`).join("")}</div>
      <div class="tb-stats">
        <div class="tb-stat tb-stat--haupt"><b>${lohn !== null ? euro(lohn) : "–"}</b><span>pro Stunde &amp; Person</span></div>
        <div class="tb-stat"><b>${tg ? `+${euro(tg)}` : "–"}</b><span>Trinkgeld</span></div>
        <div class="tb-stat"><b>${zahl(a.dauer_echt_min) ? tbDauerKurz(a.dauer_echt_min) : "–"}</b><span>gebraucht</span></div>
      </div>
    </section>`;
}

function terminkarteInhalt(a, { erfolg = false } = {}) {
  const k = kundeVon(a.kunde_id);
  const d = a.datum ? new Date(a.datum) : null;
  const termin = istTermin(a);
  const aus = Boolean(a.abgesagt) || a.termin_status === "abgelehnt";
  const phase = tbPhase(a, d);
  const bezahlt = phase === 3;
  const geschaetzt = zahl(a.geschaetzt);
  const adresse = k?.adresse ? `${k.adresse}, Berlin` : "";
  const karte = `${istIos ? "https://maps.apple.com/?q=" : "https://www.google.com/maps/search/?api=1&query="}${encodeURIComponent(adresse)}`;
  const tel = (k?.telefon || "").replace(/[^\d+]/g, "");
  const notiz = daten.notizen
    .filter((n) => n.kunde_id === a.kunde_id)
    .sort((x, y) => new Date(y.erstellt) - new Date(x.erstellt))[0];
  const fensterN = Number(a.fenster_normal || 0);
  const fensterB = Number(a.fenster_boden || 0);
  const stunden = zahl(a.stunden);
  const besuche = k ? auftraegeVon(k.id).filter((x) => zahl(x.bekommen) !== null).length : 0;
  const quote = k ? trinkgeldQuote(auftraegeVon(k.id)) : null;
  const dauerMin = termin ? Number(a.dauer_min) || 0 : dauerSchaetzung(a);

  const [chipText, chipArt] = aus
    ? [a.abgesagt ? "Abgesagt" : "Abgelehnt", "rot"]
    : termin
      ? [d ? "Termin" : "Termin offen", "blau"]
      : a.vorlaeufig && !bezahlt
        ? ["Vorläufig", "gold"]
        : [["Angefragt", "gold"], ["Geplant", "blau"], ["Geld fehlt", "orange"], ["Bezahlt", "gruen"]][phase];

  const kopf = `<header class="tb-kopf">
      <span class="tb-chip tb-chip--${chipArt}"><i></i>${chipText}</span>
      <button class="tb-eckig" type="button" data-aktion="auftrag-bearbeiten" data-id="${esc(a.id)}" data-tk-bearbeiten aria-label="${termin ? "Termin" : "Auftrag"} bearbeiten">${tbSvg(ICONS.stift)}</button>
    </header>`;

  const kontakt = (ok, href, art, icon, titel) =>
    ok
      ? `<a class="tb-rund tb-rund--${art}" href="${esc(href)}" aria-label="${titel}">${tbSvg(icon)}</a>`
      : `<span class="tb-rund tb-rund--aus" aria-label="${titel}: keine Angabe" title="${titel}: keine Angabe">${tbSvg(icon)}</span>`;
  const meta = [k?.status === "stamm" ? "Stammkunde" : besuche ? "Kunde" : "Neukunde", besuche && `${besuche} ${besuche === 1 ? "Besuch" : "Besuche"}`, quote !== null && `Ø ${quote} % Trinkgeld`].filter(Boolean).join(" · ");
  const person = k
    ? `<div class="tb-person">
        <a class="tb-person__name" href="#kunde/${esc(k.id)}" data-tk-kunde>
          <span class="tb-person__ava" aria-hidden="true">${esc(tkInitialen(k.name))}</span>
          <span class="tb-person__text"><h2 id="tk-titel">${esc(k.name)}${tbSvg(TB_ICON.pfeil)}</h2><small>${esc(meta)}</small></span>
        </a>
        <div class="tb-person__kontakt">${kontakt(!!tel, `tel:${tel}`, "blau", ICONS.kontakt, "Anrufen")}${kontakt(!!k.email, `mailto:${k.email || ""}`, "lila", ICONS.mail, "Mail schreiben")}</div>
      </div>`
    : `<div class="tb-person"><h2 id="tk-titel" class="tb-person__leer">${termin ? esc(auftragTitel(a)) : "Kunde nicht mehr vorhanden"}</h2></div>`;

  const schritte = termin || aus
    ? ""
    : `<ol class="tb-schritte${bezahlt ? " tb-schritte--fertig" : ""}" aria-label="Status">${["Angefragt", "Geplant", "Erledigt", "Bezahlt"]
        .map((t, i) => `<li class="${i < phase || bezahlt ? "an" : i === phase ? "jetzt" : ""}"${i === phase && !bezahlt ? ' aria-current="step"' : ""}><i></i><span>${t}</span></li>`)
        .join("")}</ol>`;

  let wann;
  if (!d) {
    wann = `<div class="tb-tile tb-wann tb-breit"><div><span class="tb-mini">${tbSvg(ICONS.uhr)}Wann</span><p class="tb-wann__tag">Noch offen</p><p class="tb-wann__zeit">Kein Datum ausgemacht</p></div></div>`;
  } else {
    const tage = tbTage(d);
    const uhr = `${fmtUhr.format(d)} Uhr`;
    const zeit = bezahlt ? (zahl(a.dauer_echt_min) ? `${tbDauer(a.dauer_echt_min)} gebraucht` : uhr) : `${uhr}${dauerMin ? ` · ca. ${tbDauer(dauerMin)}` : ""}`;
    const zahlTeil = bezahlt
      ? tbSvg(TK_ICON.haken)
      : tage === 0
        ? `<b class="tb-badge__wort">Heute</b>`
        : tage > 0
          ? `<b>${tage}</b><span>${tage === 1 ? "Tag" : "Tage"}</span>`
          : `<b>${-tage}</b><span>${tage === -1 ? "Tag her" : "Tage her"}</span>`;
    const art = aus ? " tb-wann--aus" : bezahlt ? " tb-wann--fertig" : phase === 2 ? " tb-wann--offen" : "";
    wann = `<div class="tb-tile tb-wann tb-breit${art}">
        <div><span class="tb-mini">${tbSvg(bezahlt ? TK_ICON.haken : ICONS.uhr)}${bezahlt ? "Erledigt" : "Wann"}</span><p class="tb-wann__tag">${esc(fmtTbTag.format(d))}</p><p class="tb-wann__zeit">${esc(zeit)}</p></div>
        <div class="tb-badge">${zahlTeil}</div>
      </div>`;
  }

  const wo = k?.adresse
    ? `<div class="tb-tile tb-wo tb-breit">
        <span class="tb-minikarte" aria-hidden="true"><i></i></span>
        <div class="tb-text"><span class="tb-mini">Wo</span><p class="tb-wert">${esc(k.adresse)}</p></div>
        <a class="tb-route" href="${esc(karte)}" target="_blank" rel="noopener" aria-label="Route starten">${tbSvg(TB_ICON.route)}</a>
      </div>`
    : "";

  const wasUnter = termin
    ? a.dauer_min ? `${Number(a.dauer_min)} Min.` : ""
    : fensterN + fensterB > 0 ? `${fensterN} normal · ${fensterB} bodentief` : stunden !== null ? `${String(stunden).replace(".", ",")} Std.` : "";
  const was = `<div class="tb-tile${termin ? " tb-breit" : ""}"><span class="tb-mini">${tbSvg(TK_ICON.fenster)}Was</span><p class="tb-wert">${esc(termin ? auftragTitel(a) : a.leistung || "Auftrag")}</p>${wasUnter ? `<p class="tb-unter">${esc(wasUnter)}</p>` : ""}</div>`;

  const team = teamVon(a);
  const wer = termin
    ? ""
    : `<div class="tb-tile"><span class="tb-mini">${tbSvg(TB_ICON.team)}Wer</span><div class="tb-avas">${team.map((n) => `<span style="background:${hfFarbe(n)}">${esc(n.charAt(0))}</span>`).join("")}</div><p class="tb-unter">${esc(team.join(" & "))}</p></div>`;

  const kamUeber = k ? kanalVonKunde(k) : a.kanal;
  const kanal = KANAELE[kamUeber]
    ? `<div class="tb-tile"><span class="tb-mini">${tbSvg(ICONS[KANAELE[kamUeber].icon] || ICONS.web)}Kam über</span><p class="tb-wert">${esc(kanalName(kamUeber))}</p></div>`
    : "";
  const schaetz = `<div class="tb-tile tb-schaetz${kanal ? "" : " tb-breit"}"><span class="tb-mini">${tbSvg(ICONS.geld)}Geschätzt</span><p class="tb-wert tb-wert--gross">${geschaetzt !== null ? `~${esc(euro(geschaetzt))}` : "–"}</p><p class="tb-unter">wird nach dem Termin eingetragen</p></div>`;

  const vorlaeufig = a.vorlaeufig && !aus && !bezahlt
    ? `<div class="tb-tile tb-vorl tb-breit"><p><b>Noch nicht bestätigt.</b> Erst „Fix machen“, wenn der Kunde zugesagt hat.</p><button class="tb-knopf tb-knopf--gold" type="button" data-aktion="termin-fix" data-id="${esc(a.id)}">Fix machen</button></div>`
    : "";

  const notizen = [
    a.notiz && `<div class="tb-tile tb-notiz tb-breit"><span class="tb-mini">${tbSvg(TB_ICON.notiz)}Notiz</span><p class="tb-wert">${esc(a.notiz)}</p></div>`,
    notiz && `<div class="tb-tile tb-notiz tb-notiz--leise tb-breit"><span class="tb-mini">${tbSvg(ICONS.stift)}Letzte Notiz zum Kunden · ${esc(fmtDatum.format(new Date(notiz.erstellt)))}</span>${anfrageTeile(notiz.text) ? `<div class="tb-wert">${notizTextHtml(notiz.text)}</div>` : `<p class="tb-wert">${esc(notiz.text)}</p>`}</div>`,
  ].filter(Boolean).join("");

  const kacheln = termin
    ? [wann, wo, was, notizen]
    : [wann, vorlaeufig, wo, was, wer, bezahlt ? tbKasse(a, erfolg) : `${schaetz}${kanal}`, notizen];

  const leiste = termin || aus
    ? ""
    : bezahlt
      ? `<div class="tb-leiste"><button class="tb-knopf tb-knopf--leise" type="button" data-aktion="auftrag-neu" data-kunde="${esc(a.kunde_id || "")}" data-tk-schliesst>${tbSvg(ICONS.termin)}Nächsten Termin planen</button></div>`
      : `<div class="tb-leiste"><button class="tb-knopf" type="button" data-tb-eintragen>${tbSvg(TK_ICON.haken)}Erledigt &amp; Geld eintragen</button></div>`;

  return `<div class="tb">${kopf}${person}${schritte}<div class="tb-grid">${kacheln.join("")}</div>${leiste}</div>`;
}

// Inhalt neu zeichnen; die Karte selbst bleibt offen
function terminkarteZeichnen(optionen = {}) {
  const a = daten.auftraege.find((x) => x.id === terminkarteId);
  if (!a) return null;
  $("[data-tk-inhalt]", terminkarte).innerHTML = terminkarteInhalt(a, optionen);
  return a;
}

function oeffneTerminkarte(id) {
  terminkarteId = id;
  if (!terminkarteZeichnen()) return;
  if (!terminkarte.open) terminkarte.showModal();
}

terminkarte.addEventListener("click", (e) => {
  const ziel = e.target;
  // Schließen, Kundenseite oder Bearbeiten: die Karte geht zu, der Rest läuft über die Bedienung weiter
  if (ziel.closest("[data-tk-bearbeiten]")) zurueckZurKarte = terminkarteId;
  if (ziel === terminkarte || ziel.closest("[data-tk-zu], [data-tk-kunde], [data-tk-bearbeiten], [data-tk-schliesst]")) {
    terminkarte.close();
    return;
  }
  if (ziel.closest("[data-tb-eintragen]")) oeffneEintragen();
});

// Pop-up „Erledigt & Geld eintragen“: Betrag, wer dabei war, wie lange
let tbPop = null;

// „Wieder melden in …“: Nie, 1–12 Wochen, dann 4–12 Monate
const WM_SCHRITTE = [null, ...Array.from({ length: 12 }, (_, i) => ({ wochen: i + 1 })), ...Array.from({ length: 9 }, (_, i) => ({ monate: i + 4 }))];
const wmText = (x) => (!x ? "Nie" : x.wochen ? `${x.wochen} ${x.wochen === 1 ? "Woche" : "Wochen"}` : `${x.monate} Monate`);
const wmStandard = (a) => (a.leistung === "Nachbarschaftshilfe" ? 0 : 8);
const LEISTUNG_WIEDER = { Fensterreinigung: "Fenster putzen", Felgenreinigung: "Felgen reinigen", Nachbarschaftshilfe: "Nachbarschaftshilfe" };
function wmDatum(x, ab = new Date()) {
  const d = new Date(ab);
  if (x.wochen) d.setDate(d.getDate() + x.wochen * 7);
  else d.setMonth(d.getMonth() + x.monate);
  return isoAusDatum(d);
}

function oeffneEintragen() {
  const a = daten.auftraege.find((x) => x.id === terminkarteId);
  if (!a) return;
  if (!tbPop) {
    tbPop = document.createElement("dialog");
    tbPop.className = "tb-pop";
    tbPop.setAttribute("aria-label", "Geld eintragen");
    document.body.append(tbPop);
    tbPopEreignisse();
  }
  const k = kundeVon(a.kunde_id);
  const d = a.datum ? new Date(a.datum) : null;
  const g = zahl(a.geschaetzt);
  const b = zahl(a.bekommen);
  const start = b ?? g;
  const min = Math.max(15, Math.round((zahl(a.dauer_echt_min) || dauerVon(a).min) / 15) * 15);
  const schnell = g !== null && g > 0 ? [g - 10, g, g + 10, g + 20].filter((x) => x > 0).map((x) => Math.round(x * 100) / 100) : [];
  tbPop.innerHTML = `<form class="tb-pop__blatt" data-tb-form novalidate>
      <div class="tb-pop__griff" aria-hidden="true"></div>
      <h3>${b !== null ? "Betrag ändern" : "Termin erledigt"}</h3>
      <p class="tb-pop__sub">${esc([k?.name, d && fmtTbTag.format(d), g !== null && `geschätzt ~${euro(g)}`].filter(Boolean).join(" · "))}</p>
      <label class="tb-feld" for="tb-betrag">Wie viel habt ihr bekommen? <em>mit Trinkgeld</em></label>
      <span class="tb-geld"><input id="tb-betrag" name="bekommen" type="text" inputmode="decimal" autocomplete="off" value="${start === null ? "" : esc(String(start).replace(".", ","))}" data-tk-betrag /><span aria-hidden="true">€</span></span>
      ${schnell.length ? `<div class="tb-schnell">${schnell.map((x) => `<button type="button" data-tb-betrag="${x}">${euro(x)}</button>`).join("")}</div>` : ""}
      <p class="tb-hinweis" data-tk-tg></p>
      <p class="tb-feld">Wer war dabei?</p>
      ${teamChips(teamVon(a))}
      <p class="tb-feld">Wie lange hat's gedauert?</p>
      <div class="tb-dauer">
        <button type="button" data-tb-dauer="-15" aria-label="15 Minuten weniger">−</button>
        <output data-tb-min="${min}" aria-live="polite">${tbDauer(min)}</output>
        <button type="button" data-tb-dauer="15" aria-label="15 Minuten mehr">+</button>
      </div>
      <div class="tb-vorschau" data-tb-vorschau></div>
      ${b === null && !istTermin(a) && a.kunde_id ? `<p class="tb-feld">Wieder melden in</p>
      <div class="tb-dauer tb-wieder">
        <button type="button" data-tb-wm="-1" aria-label="Früher">−</button>
        <output data-tb-wm-i="${wmStandard(a)}" aria-live="polite">${wmText(WM_SCHRITTE[wmStandard(a)])}</output>
        <button type="button" data-tb-wm="1" aria-label="Später">+</button>
      </div>
      <p class="tb-hinweis">Legt eine Aufgabe mit Push um 16 Uhr an: „wieder ${esc(LEISTUNG_WIEDER[a.leistung] || a.leistung || "")} anbieten“.</p>` : ""}
      <p class="meldung minus" data-tk-fehler role="alert"></p>
      <button class="tb-knopf tb-knopf--gruen" type="submit">${tbSvg(TK_ICON.haken)}Speichern</button>
      <button class="tb-knopf tb-knopf--text" type="button" data-tb-zu>Abbrechen</button>
    </form>`;
  tbVorschau();
  tbPop.showModal();
}

// Live: Trinkgeld, Stundenlohn pro Person und Aufteilung, während man tippt
function tbVorschau() {
  const a = daten.auftraege.find((x) => x.id === terminkarteId);
  const form = $("[data-tb-form]", tbPop);
  if (!a || !form) return;
  const roh = $("[data-tk-betrag]", form).value;
  const betrag = betragLesen(roh);
  const team = teamAusForm(form);
  const min = Number($("[data-tb-min]", form).dataset.tbMin);
  form.querySelectorAll("[data-tb-betrag]").forEach((x) => x.classList.toggle("an", betrag !== null && Number(x.dataset.tbBetrag) === betrag));
  $("[data-tk-tg]", form).innerHTML = tgTextFuer(betrag, zahl(a.geschaetzt));
  const lohn = stundenlohnProPerson(betrag, team, min);
  $("[data-tb-vorschau]", form).innerHTML = lohn === null
    ? ""
    : `<b>${euro(lohn)}</b> pro Stunde &amp; Person<small>${aufteilungText(kontoAufteilung({ ...a, bekommen: betrag, team }), betrag)}</small>`;
  $("[data-tk-fehler]", form).textContent = "";
}

function tbPopEreignisse() {
  tbPop.addEventListener("click", (e) => {
    const t = e.target;
    if (t === tbPop || t.closest("[data-tb-zu]")) return tbPop.close();
    const b = t.closest("[data-tb-betrag]");
    if (b) {
      $("[data-tk-betrag]", tbPop).value = b.dataset.tbBetrag.replace(".", ",");
      return tbVorschau();
    }
    const d = t.closest("[data-tb-dauer]");
    if (d) {
      const out = $("[data-tb-min]", tbPop);
      const m = Math.max(15, Math.min(720, Number(out.dataset.tbMin) + Number(d.dataset.tbDauer)));
      out.dataset.tbMin = m;
      out.textContent = tbDauer(m);
      tbVorschau();
    }
    const w = t.closest("[data-tb-wm]");
    if (w) {
      const out = $("[data-tb-wm-i]", tbPop);
      const i = Math.max(0, Math.min(WM_SCHRITTE.length - 1, Number(out.dataset.tbWmI) + Number(w.dataset.tbWm)));
      out.dataset.tbWmI = i;
      out.textContent = wmText(WM_SCHRITTE[i]);
    }
  });
  tbPop.addEventListener("input", tbVorschau);
  tbPop.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const a = daten.auftraege.find((x) => x.id === terminkarteId);
    if (!a) return;
    const feld = $("[data-tk-betrag]", form);
    const betrag = betragLesen(feld.value);
    if (betrag === null) {
      $("[data-tk-fehler]", form).textContent = "Bitte eine Zahl eingeben, zum Beispiel 34 oder 34,50.";
      feld.focus();
      return;
    }
    const team = teamAusForm(form);
    if (!team.length) {
      $("[data-tk-fehler]", form).textContent = "Bitte ankreuzen, wer dabei war.";
      return;
    }
    const knopf = form.querySelector("[type=submit]");
    knopf.disabled = true;
    try {
      const warSchonBezahlt = zahl(a.bekommen) !== null;
      const dauer = Number($("[data-tb-min]", form).dataset.tbMin);
      await aendern("auftraege", a.id, { bekommen: betrag, team, dauer_echt_min: dauer });
      await lohnBuchen({ ...a, bekommen: betrag, team });
      // Verlauf und Stammkunden-Status nur beim ersten Eintrag, bei einer Korrektur nicht noch einmal
      if (!warSchonBezahlt) await nachBezahlung(a.kunde_id, { ...a, bekommen: betrag });
      const wm = WM_SCHRITTE[Number($("[data-tb-wm-i]", form)?.dataset.tbWmI || 0)];
      if (wm && !warSchonBezahlt) {
        const k = kundeVon(a.kunde_id);
        await neu("aufgaben", {
          titel: `${k?.name || "Kunde"}: wieder ${LEISTUNG_WIEDER[a.leistung] || a.leistung} anbieten`,
          zustaendig: "Beide",
          faellig: wmDatum(wm, a.datum ? new Date(a.datum) : new Date()),
          uhrzeit: "16:00",
          push: true,
          vorlauf_min: 0,
          kunde_id: a.kunde_id,
          erledigt: false,
        });
      }
      tbPop.close();
      terminkarteZeichnen({ erfolg: true });
      zeigeToast(`${euro(betrag)} eingetragen`);
      render();
    } catch {
      // Der Fehler steht schon im Toast (speichern)
      knopf.disabled = false;
    }
  });
}

// Wie die anderen Dialoge: solange die Karte offen ist, wird die Seite nicht unter ihr neu gezeichnet
terminkarte.addEventListener("close", () => wartetAufRender && render());

// Nach dem Bearbeiten im Auftragsdialog (Speichern, Abbrechen oder Löschen) geht die Terminkarte wieder auf, mit den neuen Daten.
// Bewusst kein close-Ereignis: das kam in dieser Umgebung nicht zuverlässig an.
function karteZurueckOeffnen() {
  if (zurueckZurKarte === null) return;
  const id = zurueckZurKarte;
  zurueckZurKarte = null;
  oeffneTerminkarte(id); // gelöschter Auftrag: dann geht nichts auf
}

/* ===================== Neue Anfrage: großes Popup ===================== */

// Das Popup bleibt auf jedem Gerät, bis jemand bestätigt, ablehnt oder einen anderen Termin vorschlägt.
// „Später“ schiebt es nur weg, bis die App wieder geöffnet wird.
const spaeterListe = new Set();
const inArbeit = new Set();
try {
  localStorage.removeItem("klarglas-anfragen-gesehen");
} catch {}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  spaeterListe.clear();
  anfragePopupPruefen();
});

// Offene Wunschtermine und frische Website-Anfragen ohne Termin
const neueAnfragen = () => {
  return daten.auftraege
    .filter(
      (a) =>
        !a.abgesagt &&
        (a.termin_status === "angefragt" ||
          (a.kanal === "website" && !a.datum && kundeVon(a.kunde_id)?.status === "neu"))
    )
    .sort((a, b) => new Date(b.erstellt || 0) - new Date(a.erstellt || 0));
};

const anfragePopup = $("[data-anfrage-popup]");

function anfragePopupPruefen() {
  if (!db || anfragePopup.open || $("[data-dialog]").open || diagrammDialog.open || terminkarte.open || $("[data-menue-sheet]").open) return;
  const offen = neueAnfragen().filter((a) => !spaeterListe.has(a.id) && !inArbeit.has(a.id));
  if (!offen.length) return;
  const a = offen[0];
  anfragePopup.dataset.id = a.id;
  const k = kundeVon(a.kunde_id) || {};
  const d = a.datum ? new Date(a.datum) : null;
  const fenster = a.fenster_normal || a.fenster_boden ? `${Number(a.fenster_normal || 0)} normale + ${Number(a.fenster_boden || 0)} bodentiefe Fenster` : "";
  const info = (titel, wert) => (wert ? `<div class="ap-info"><dt>${titel}</dt><dd>${wert}</dd></div>` : "");
  $("[data-ap-inhalt]").innerHTML = `
    <p class="ap-oben">${kanalMarke(a.kanal)}<span>Neue Anfrage${offen.length > 1 ? ` · noch ${offen.length - 1} weitere` : ""}</span></p>
    <h2 class="ap-name" id="ap-titel">${esc(k.name || "Unbekannt")}</h2>
    <p class="ap-wann">${d ? `${esc(fmtTagLang.format(d))} · ${esc(fmtUhr.format(d))} Uhr` : "Noch kein Wunschtermin"}</p>
    <dl class="ap-infos">
      ${info("Leistung", esc(a.leistung || ""))}
      ${info("Fenster", esc(fenster))}
      ${info("Preis", zahl(a.geschaetzt) !== null ? `ca. ${euro(a.geschaetzt)}` : "")}
      ${info("Adresse", esc(k.adresse || ""))}
      ${info("Kontakt", [k.telefon && `<a href="tel:${esc(k.telefon)}">${esc(k.telefon)}</a>`, k.email && `<a href="mailto:${esc(k.email)}">${esc(k.email)}</a>`].filter(Boolean).join(" · "))}
      ${info("Nachricht", a.notiz ? esc(a.notiz) : "")}
    </dl>
    <div class="ap-knoepfe">
      ${
        a.termin_status === "angefragt"
          ? `<button class="knopf knopf--voll knopf--gross" type="button" autofocus data-aktion="termin-bestaetigen" data-id="${esc(a.id)}">Bestätigen</button>
             <button class="knopf knopf--gross" type="button" data-aktion="termin-verschieben" data-id="${esc(a.id)}">Anderer Termin</button>
             <button class="knopf knopf--leise knopf--gefahr knopf--gross" type="button" data-aktion="termin-ablehnen" data-id="${esc(a.id)}">Ablehnen</button>`
          : `<button class="knopf knopf--voll knopf--gross" type="button" autofocus data-aktion="anfrage-kontakt" data-id="${esc(a.id)}">Bin in Kontakt</button>
             <a class="knopf knopf--gross" href="#kunde/${esc(a.kunde_id)}" data-ap-kunde="${esc(a.id)}">Kunde öffnen</a>`
      }
    </div>
    <button class="ap-spaeter" type="button" data-ap-spaeter="${esc(a.id)}">Später – kommt beim nächsten Öffnen wieder</button>`;
  anfragePopup.showModal();
}

anfragePopup.addEventListener("click", (e) => {
  const ziel = e.target;
  const knopf = ziel.closest("[data-ap-spaeter], [data-ap-kunde], [data-aktion]");
  if (knopf?.dataset.aktion) {
    // Kurz Ruhe, bis die Aktion durch ist; wird sie abgebrochen, kommt das Popup wieder
    const id = knopf.dataset.id;
    inArbeit.add(id);
    setTimeout(() => {
      inArbeit.delete(id);
      anfragePopupPruefen();
    }, 6000);
  } else if (knopf) spaeterListe.add(knopf.dataset.apSpaeter || knopf.dataset.apKunde);
  else if (ziel === anfragePopup) spaeterListe.add(anfragePopup.dataset.id);
  if (ziel === anfragePopup || knopf) anfragePopup.close();
});
// Escape zählt wie „Später“
anfragePopup.addEventListener("cancel", () => spaeterListe.add(anfragePopup.dataset.id));
anfragePopup.addEventListener("close", () => setTimeout(anfragePopupPruefen, 400));

/* ===================== Mails an Kunden ===================== */

// Fertige Mail fürs Mailprogramm; abschicken macht ihr selbst
function kundenMail(k, art, a) {
  const d = a.datum ? new Date(a.datum) : null;
  const wann = d ? `${fmtTagLang.format(d)} um ${fmtUhr.format(d)} Uhr` : "";
  const gruss = "Viele Grüße\nLouis & Lukas, Klar Glas";
  if (art === "bestaetigt") {
    const wofuer = istTermin(a) ? `zur ${auftragTitel(a)}` : "";
    return {
      betreff: `Ihr Termin bei Klar Glas am ${d ? fmtTagLang.format(d) : ""}`,
      text:
        `Guten Tag ${k.name},\n\nIhr Termin steht: Wir kommen ${wann} ${wofuer} vorbei.\n\n`.replace("  ", " ") +
        (k.adresse ? `Ort: ${k.adresse}\n` : "") +
        (istTermin(a) ? "\n" : `Leistung: ${a.leistung}\n${zahl(a.geschaetzt) !== null ? `Geschätzter Preis: ca. ${euro(a.geschaetzt)} (Sie zahlen bar vor Ort)` : "Sie zahlen bar vor Ort."}\n\n`) +
        `Falls etwas dazwischenkommt, antworten Sie einfach auf diese Mail.\n\n${gruss}`,
    };
  }
  if (art === "vorschlag") {
    return {
      betreff: "Neuer Terminvorschlag – Klar Glas",
      text: `Guten Tag ${k.name},\n\nIhr Wunschtermin klappt leider nicht – passt Ihnen ${wann} stattdessen?\nAntworten Sie kurz mit Ja, dann tragen wir ihn fest ein.\n\n${gruss}`,
    };
  }
  return {
    betreff: "Ihr Wunschtermin bei Klar Glas",
    text: `Guten Tag ${k.name},\n\nleider passt Ihr Wunschtermin zeitlich nicht in unseren Plan. Bitte wählen Sie einen neuen Termin auf klarglas-berlin.de/kontakt.html oder antworten Sie auf diese Mail.\n\n${gruss}`,
  };
}

// v23: Es öffnet sich kein Mailprogramm mehr, nur die kurze Meldung (Name bleibt, damit die Aufrufe gleich bleiben)
function mailOeffnen(k, art, a, erledigt) {
  zeigeToast(erledigt);
}

/* ===================== Push-Benachrichtigungen ===================== */

const pushGeht = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && Boolean(CFG.VAPID_PUBLIC);
const istIphoneImBrowser = () => /iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone;
let pushAn = false;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .then((r) => r.pushManager?.getSubscription())
    .then((abo) => {
      pushAn = Boolean(abo) && Notification.permission === "granted";
      if (route().bereich === "einstellungen") renderSpaeter();
    })
    .catch(() => {});
}

const base64UrlZuBytes = (text) => {
  const b = atob(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "="));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

function pushText() {
  if (pushAn) return "An – neue Anfragen kommen als Mitteilung auf dieses Gerät.";
  if (istIphoneImBrowser()) return "Am iPhone geht das nur in der App vom Home-Bildschirm (Teilen → Zum Home-Bildschirm).";
  if (!pushGeht()) return "Dieser Browser kann leider keine Mitteilungen.";
  if (Notification.permission === "denied") return "Blockiert – in den Einstellungen des Geräts für Klar Glas erlauben.";
  return "Aus – dieses Gerät meldet neue Anfragen nicht.";
}

async function pushUmschalten() {
  if (!pushGeht() || istIphoneImBrowser()) return zeigeToast(pushText(), 6000);
  try {
    if (pushAn) {
      const reg = await navigator.serviceWorker.ready;
      const abo = await reg.pushManager.getSubscription();
      if (abo) {
        if (!db.lokal) await supa.from("push_abos").delete().eq("endpoint", abo.endpoint);
        await abo.unsubscribe();
      }
      pushAn = false;
      zeigeToast("Mitteilungen aus");
    } else {
      // Muss direkt aus dem Tippen kommen, sonst fragt das iPhone nicht
      const erlaubnis = await Notification.requestPermission();
      if (erlaubnis !== "granted") return zeigeToast(pushText(), 6000);
      const reg = await navigator.serviceWorker.ready;
      const abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlZuBytes(CFG.VAPID_PUBLIC) });
      const j = abo.toJSON();
      if (!db.lokal) {
        const { error } = await supa.from("push_abos").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, wer: ich });
        if (error) throw new Error(error.message);
      }
      pushAn = true;
      zeigeToast("Mitteilungen an");
    }
  } catch (e) {
    zeigeToast(`Mitteilungen gingen nicht: ${e.message}`, 7000);
  }
  if (route().bereich === "einstellungen") render();
}

/* ===================== Bedienung ===================== */

document.addEventListener("click", async (event) => {
  const el = event.target.closest("[data-aktion]");
  if (!el || !db) return;
  const { aktion, id, wert } = el.dataset;
  const finden = (t) => daten[t].find((x) => x.id === id);

  switch (aktion) {
    case "push-umschalten": return pushUmschalten();
    case "kunde-neu": return dialogKunde();
    case "kunde-bearbeiten": return dialogKunde(kundeVon(id));
    case "auftrag-neu": return dialogAuftrag({}, el.dataset.kunde || (route().bereich === "kunde" ? route().id : null));
    case "auftrag-bearbeiten": {
      const a = finden("auftraege");
      return istTermin(a) ? dialogTermin(a) : dialogAuftrag(a);
    }
    case "termin-neu": return dialogTermin({}, el.dataset.kunde || (route().bereich === "kunde" ? route().id : null));
    case "termin-karte": return oeffneTerminkarte(id);
    case "ausgabe-neu": return dialogAusgabe();
    case "ausgabe-bearbeiten": return dialogAusgabe(finden("ausgaben"));
    case "auszahlung-neu": return dialogAuszahlung();
    case "auszahlung-bearbeiten": return dialogAuszahlung(finden("auszahlungen"));
    case "aufgabe-neu": return dialogAufgabe();
    case "aufgabe-bearbeiten": return dialogAufgabe(finden("aufgaben"));
    case "filter":
      zustand.kundenFilter = wert;
      return render();
    case "kunden-ansicht":
      zustand.kundenAnsicht = wert;
      if (wert === "kunden") zustand.auftraegeZeitraum = null;
      return render();
    case "auftraege-zeitraum-weg":
      zustand.auftraegeZeitraum = null;
      return render();
    case "aufgaben-filter":
      zustand.aufgabenFilter = wert;
      return render();
    case "schritt":
      zustand.geldStichtag = zeitraumVerschieben(aktuellerZeitraum(), zustand.geldStichtag, Number(wert));
      return render();
    case "zeitraum":
      zustand.geldPillePrev = ZEITRAUM_POS[zustand.geldZeitraum];
      zustand.geldZeitraum = wert;
      return render();
    case "geld-tab":
      return oeffneDiagramm(wert);
    case "mitarbeiter-neu":
      return dialogMitarbeiter();
    case "kanal-neu":
      return dialogKanal();
    case "kanal-weg":
      return kanalEntfernen(id);
    case "mitarbeiter-umbenennen":
      return dialogMitarbeiter(finden("mitarbeiter"));
    case "mitarbeiter-archivieren": {
      const m = finden("mitarbeiter");
      await aendern("mitarbeiter", id, { aktiv: m.aktiv === false });
      zeigeToast(m.aktiv === false ? `${m.name} ist wieder dabei` : `${m.name} archiviert`);
      return render();
    }
    case "aufgabe-haken": {
      const a = finden("aufgaben");
      await aendern("aufgaben", id, { erledigt: !a.erledigt });
      zeigeToast(a.erledigt ? "Wieder offen" : "Erledigt");
      return render();
    }
    case "aufgabe-kopieren": {
      const a = finden("aufgaben");
      try {
        await navigator.clipboard.writeText(a.titel + (a.faellig ? ` (bis ${fmtTag.format(new Date(a.faellig))})` : ""));
        zeigeToast("Kopiert");
      } catch {
        zeigeToast("Kopieren ging nicht");
      }
      return;
    }
    case "erstatten": {
      const x = finden("ausgaben");
      if (kassenstand() < x.betrag && !confirm(`In der Kasse sind nur ${euro(kassenstand())}. Trotzdem erstatten?`)) return;
      await neu("auszahlungen", { betrag: x.betrag, datum: heuteIso(), an: x.bezahlt_von, art: "erstattung", notiz: `Erstattung ${x.kategorie}${x.notiz ? `: ${x.notiz}` : ""}` });
      await aendern("ausgaben", id, { erstattet: true });
      zeigeToast(`${euro(x.betrag)} an ${x.bezahlt_von} erstattet`);
      return render();
    }
    case "termin-bestaetigen": {
      const a = finden("auftraege");
      const k = kundeVon(a.kunde_id);
      if (db.lokal) {
        await aendern("auftraege", id, { termin_status: "bestaetigt" });
        await aendern("kunden", a.kunde_id, { status: "termin" });
        await notiz(a.kunde_id, "Termin bestätigt");
      } else {
        el.disabled = true;
        el.textContent = "Wird bestätigt …";
        try {
          await terminAktion(id, "bestaetigen");
        } catch (e) {
          el.disabled = false;
          el.textContent = "Bestätigen";
          zeigeToast(`Bestätigen hat nicht geklappt: ${e.message}`, 7000);
          return;
        }
      }
      mailOeffnen(k, "bestaetigt", a, "Bestätigt");
      return render();
    }
    case "datum-festlegen": {
      const a = finden("auftraege");
      oeffneDialog({
        titel: "Datum festlegen",
        felder: `<p class="leise" style="margin:0">${esc(auftragName(a))}${a.leistung ? ` · ${esc(a.leistung)}` : ""}</p>
          <label class="feld"><span>Wann</span><input type="datetime-local" name="datum" required /></label>
          ${vorlaeufigSchalter({ vorlaeufig: false })}`,
        absenden: async (f) => {
          const zeile = { datum: lokalZuIso(f.datum), vorlaeufig: Boolean(f.vorlaeufig) };
          await aendern("auftraege", id, zeile);
          if (a.kunde_id) await statusNachTermin(a.kunde_id, { ...a, ...zeile });
          await kalenderAbgleichen(id);
        },
      });
      return;
    }
    case "termin-fix": {
      const a = finden("auftraege");
      if (!a.datum) return istTermin(a) ? dialogTermin(a) : dialogAuftrag(a);
      const fest = { vorlaeufig: false, ...(a.termin_status === "angefragt" ? { termin_status: "bestaetigt" } : {}) };
      await aendern("auftraege", id, fest);
      if (a.kunde_id) await statusNachTermin(a.kunde_id, { ...a, ...fest });
      await kalenderAbgleichen(id);
      if (terminkarte.open) terminkarteZeichnen();
      mailOeffnen(kundeVon(a.kunde_id), "bestaetigt", a, "Termin steht fest");
      return render();
    }
    case "termin-ablehnen": {
      if (!confirm("Termin wirklich ablehnen?")) return;
      const a = finden("auftraege");
      const k = kundeVon(a.kunde_id);
      if (db.lokal) {
        await aendern("auftraege", id, { termin_status: "abgelehnt" });
        await notiz(a.kunde_id, "Terminanfrage abgelehnt");
      } else {
        try {
          await terminAktion(id, "ablehnen");
        } catch (e) {
          zeigeToast(`Ablehnen hat nicht geklappt: ${e.message}`, 7000);
          return;
        }
      }
      mailOeffnen(k, "abgelehnt", a, "Abgelehnt");
      return render();
    }
    case "anfrage-kontakt": {
      const a = finden("auftraege");
      const k = kundeVon(a?.kunde_id);
      if (k && k.status === "neu") {
        await aendern("kunden", k.id, { status: "kontakt" });
        await notiz(k.id, `Status → ${STATUS_NAME.kontakt}`);
      }
      return render();
    }
    case "termin-verschieben": {
      const a = finden("auftraege");
      oeffneDialog({
        titel: "Neuen Termin vorschlagen",
        felder: `<label class="feld"><span>Neuer Wunschtermin</span><input type="datetime-local" name="datum" required value="${esc(isoZuLokal(a.datum))}" /></label>`,
        absenden: async (f) => {
          const neuIso = lokalZuIso(f.datum);
          // Vorschlag = vorläufiger Termin („Geplant“), bis der Kunde zusagt → dann „Fix machen“
          const vorschlag = { datum: neuIso, vorlaeufig: true, termin_status: null };
          await aendern("auftraege", id, vorschlag);
          await notiz(a.kunde_id, `Termin vorgeschlagen: ${fmtTagLang.format(new Date(neuIso))} ${fmtUhr.format(new Date(neuIso))}`);
          if (a.kunde_id) await statusNachTermin(a.kunde_id, { ...a, ...vorschlag });
          await kalenderAbgleichen(id);
          mailOeffnen(kundeVon(a.kunde_id), "vorschlag", { ...a, datum: neuIso }, "Neuer Termin vorgeschlagen");
        },
      });
      return;
    }
    case "konto-auszahlen": {
      const g = guthabenVon(wert);
      return dialogAuszahlung({ an: wert, betrag: g > 0 ? cent(g) : "" });
    }
    case "verfueg-add": {
      const wochentag = Number(wert);
      await neu("verfuegbarkeit", { wochentag, von: "09:00", bis: "17:00" });
      return render();
    }
    case "kalender-neu":
      return dialogKalender();
    case "blocker-neu":
      return dialogBlocker();
    case "kalender-entfernen": {
      const k = finden("kalender");
      if (!confirm(`„${k.name}“ entfernen? Der Google-Kalender selbst bleibt unverändert.`)) return;
      await loeschen("kalender", id);
      return render();
    }
    case "blocker-entfernen":
      await loeschen("blocker", id);
      return render();
    case "kalender-pruefen": {
      el.disabled = true;
      el.textContent = "Prüfe …";
      try {
        zustand.kalenderPruefung = await kalenderPruefen();
        const kaputt = Object.values(zustand.kalenderPruefung.kalender || {}).filter((s) => s !== "ok").length;
        zeigeToast(kaputt ? `${kaputt} Kalender noch nicht freigegeben` : "Alle Kalender erreichbar", 4000);
      } catch (e) {
        zeigeToast(`Prüfen hat nicht geklappt: ${e.message}`, 7000);
      }
      return render();
    }
    case "kalender-mail-kopieren":
      try {
        await navigator.clipboard.writeText(wert);
        zeigeToast("Adresse kopiert");
      } catch {
        zeigeToast("Kopieren ging nicht");
      }
      return;
    case "verfueg-entfernen": {
      await loeschen("verfuegbarkeit", id);
      return render();
    }
  }
});

// Betrag nach dem Termin eintragen und Notiz speichern
inhalt.addEventListener("submit", async (event) => {
  const form = event.target;
  event.preventDefault();
  if (form.dataset.eintragen) {
    const a = daten.auftraege.find((x) => x.id === form.dataset.eintragen);
    const bekommen = Number(new FormData(form).get("bekommen"));
    const team = teamVon(a);
    await aendern("auftraege", a.id, { bekommen, team });
    await lohnBuchen({ ...a, bekommen, team });
    await nachBezahlung(a.kunde_id, { ...a, bekommen });
    zeigeToast(`${euro(bekommen)} eingetragen`);
    render();
  } else if (form.dataset.notizForm) {
    const f = new FormData(form);
    const text = f.get("text").trim();
    if (!text) return;
    const quelle = f.get("quelle") || "notiz";
    await neu("notizen", { kunde_id: form.dataset.notizForm, text, autor: ich, automatisch: false, quelle: quelle === "notiz" ? null : quelle });
    render();
  }
});

inhalt.addEventListener("input", (event) => {
  if (event.target.matches("[data-suche]")) {
    zustand.suche = event.target.value;
    render();
  }
});

inhalt.addEventListener("change", async (event) => {
  const el = event.target;
  if (el.dataset.statusWahl) {
    const id = el.dataset.statusWahl;
    await aendern("kunden", id, { status: el.value });
    await notiz(id, `Status → ${STATUS_NAME[el.value]}`);
    zeigeToast(`Status: ${STATUS_NAME[el.value]}`);
    render();
  } else if (el.dataset.weiter) {
    await aendern("kunden", el.dataset.weiter, { weiter: el.value.trim() || null });
    zeigeToast("Gespeichert");
  } else if (el.dataset.kalenderArt) {
    // Nur ein Kalender zum Eintragen
    if (el.value === "eintragen") {
      for (const k of daten.kalender.filter((x) => x.art === "eintragen" && x.id !== el.dataset.kalenderArt)) await aendern("kalender", k.id, { art: "lesen" });
    }
    await aendern("kalender", el.dataset.kalenderArt, { art: el.value });
    zeigeToast("Gespeichert");
    render();
  } else if (el.dataset.kalenderAktiv) {
    await aendern("kalender", el.dataset.kalenderAktiv, { aktiv: el.checked });
    zeigeToast(el.checked ? "Kalender an" : "Kalender aus");
  } else if (el.dataset.verfuegId && el.dataset.verfuegField) {
    const verfuegId = el.dataset.verfuegId;
    const field = el.dataset.verfuegField;
    await aendern("verfuegbarkeit", verfuegId, { [field]: el.value });
    zeigeToast("Gespeichert");
  } else if (el.dataset.einstell && el.dataset.einstellField) {
    const field = el.dataset.einstellField;
    await aendern("einstellungen", daten.einstellungen[0]?.id ?? 1, { [field]: Number(el.value) });
    zeigeToast("Gespeichert");
  }
});

// Kanban: Karte in eine andere Spalte ziehen ändert den Status
let gezogen = null;
inhalt.addEventListener("dragstart", (e) => {
  const karte = e.target.closest("[data-kunde]");
  if (!karte) return;
  gezogen = karte.dataset.kunde;
  karte.classList.add("zieht");
  e.dataTransfer.effectAllowed = "move";
});
inhalt.addEventListener("dragend", (e) => e.target.closest?.("[data-kunde]")?.classList.remove("zieht"));
inhalt.addEventListener("dragover", (e) => {
  const spalte = e.target.closest("[data-spalte]");
  if (!spalte || !gezogen) return;
  e.preventDefault();
  inhalt.querySelectorAll(".ist-ziel").forEach((s) => s !== spalte && s.classList.remove("ist-ziel"));
  spalte.classList.add("ist-ziel");
});
inhalt.addEventListener("drop", async (e) => {
  const spalte = e.target.closest("[data-spalte]");
  if (!spalte || !gezogen) return;
  e.preventDefault();
  const id = gezogen;
  gezogen = null;
  const status = spalte.dataset.spalte;
  if (kundeVon(id)?.status !== status) {
    await aendern("kunden", id, { status });
    await notiz(id, `Status → ${STATUS_NAME[status]}`);
  }
  render();
});

/* ===================== Start ===================== */

async function starten(neueDb, name) {
  db = neueDb;
  ich = name;
  $("[data-anmeldung]").hidden = true;
  inhalt.hidden = false;
  $("[data-nav]").hidden = false;
  await Promise.all(TABELLEN.map(laden));
  try {
    await statusAlleAbgleichen();
  } catch {}
  db.abonnieren(async (t) => {
    await laden(t);
    renderSpaeter();
  });
  render();
  hLadeFertig();
}

// Team-Liste enthält nur SHA-256-Werte der Adressen
async function teamName(email) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email)));
  const hash = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return CFG.TEAM[hash] || null;
}

// Login-Mails sind bei Supabase knapp – deshalb kurze Sperre nach jedem Versand
const LINK_SPERRE_MS = 60000;
const linkGesperrtBis = () => {
  try {
    return Number(localStorage.getItem("klarglas-link-sperre")) || 0;
  } catch {
    return 0;
  }
};

function anmeldungZeigen(client, meldung = "") {
  hLadeFertig();
  inhalt.hidden = true;
  $("[data-nav]").hidden = true;
  $("[data-anmeldung]").hidden = false;
  const form = $("[data-anmelde-form]");
  const ausgabe = $("[data-anmelde-meldung]");
  const knopf = $("[data-anmelde-knopf]");
  const passwortFeld = form.elements.passwort;
  ausgabe.textContent = meldung;
  const beschriften = () => (knopf.textContent = passwortFeld.value ? "Anmelden" : "Login-Link schicken");
  passwortFeld.addEventListener("input", beschriften);
  beschriften();

  form.onsubmit = async (event) => {
    event.preventDefault();
    // Unsichtbare Zeichen (z. B. aus Autofill oder Kopieren) entfernen
    const email = String(new FormData(form).get("email") || "").replace(/[\s\u200B-\u200D\uFEFF]/g, "").toLowerCase();
    const passwort = passwortFeld.value;
    if (!(await teamName(email))) {
      ausgabe.textContent = `„${email}“ hat keinen Zugang. Nimm die Adresse, mit der du in Supabase eingeladen bist.`;
      return;
    }
    knopf.disabled = true;
    if (passwort) {
      const { error } = await client.auth.signInWithPassword({ email, password: passwort });
      knopf.disabled = false;
      if (error) {
        ausgabe.textContent = /invalid/i.test(error.message)
          ? "E-Mail oder Passwort stimmt nicht. Noch kein Passwort? Feld leer lassen und Login-Link holen."
          : `Das hat nicht geklappt: ${error.message}`;
      }
      return; // Erfolg: onAuthStateChange öffnet das Dashboard
    }
    const rest = linkGesperrtBis() - Date.now();
    if (rest > 0) {
      knopf.disabled = false;
      ausgabe.textContent = `Ein Link ist schon unterwegs – schau in dein Postfach (auch Spam). Neuer Link in ${Math.ceil(rest / 1000)} Sekunden.`;
      return;
    }
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
    });
    knopf.disabled = false;
    if (error) {
      ausgabe.textContent = /rate limit/i.test(error.message)
        ? "Supabase verschickt gerade keine weiteren Mails (Limit pro Stunde). Nimm den letzten Link aus deinem Postfach oder melde dich mit Passwort an."
        : `Das hat nicht geklappt: ${error.message}`;
      return;
    }
    try {
      localStorage.setItem("klarglas-link-sperre", String(Date.now() + LINK_SPERRE_MS));
    } catch {
      /* egal */
    }
    ausgabe.textContent = "Check dein Postfach und tipp auf den Link in der E-Mail. Danach unter „Passwort“ eins festlegen, dann brauchst du keine Mails mehr.";
  };
}

function dialogPasswort() {
  oeffneDialog({
    titel: "Passwort festlegen",
    knopf: "Speichern",
    felder: `
      <p class="hinweis">Damit meldest du dich künftig ohne Login-Mail an. Mindestens 8 Zeichen.</p>
      <label class="feld"><span>Neues Passwort</span><input name="eins" type="password" autocomplete="new-password" minlength="8" required /></label>
      <label class="feld"><span>Nochmal</span><input name="zwei" type="password" autocomplete="new-password" minlength="8" required /></label>`,
    absenden: async (f) => {
      if (f.eins.length < 8) throw new Error("Mindestens 8 Zeichen.");
      if (f.eins !== f.zwei) throw new Error("Die beiden Passwörter sind nicht gleich.");
      const { error } = await supa.auth.updateUser({ password: f.eins });
      if (error) throw new Error(error.message);
      zeigeToast("Passwort gespeichert – ab jetzt ohne Mail anmelden", 4000);
    },
  });
}

(async function init() {
  if (!CFG.SUPABASE_URL || !window.supabase) {
    $("[data-testmodus]").hidden = false;
    await starten(lokaleDb(), "Louis");
    return;
  }

  const client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  supa = client;
  const abmelden = $("[data-abmelden]");
  const passwortKnopf = $("[data-passwort-setzen]");
  passwortKnopf.onclick = () => dialogPasswort();
  abmelden.onclick = async () => {
    await client.auth.signOut();
    location.reload();
  };

  const mitSitzung = async (session) => {
    const email = session?.user?.email?.toLowerCase();
    if (!email) return anmeldungZeigen(client);
    const name = await teamName(email);
    if (!name) {
      await client.auth.signOut();
      return anmeldungZeigen(client, `Angemeldet als „${email}“ – diese Adresse hat keinen Zugang.`);
    }
    abmelden.hidden = false;
    passwortKnopf.hidden = false;
    if (!db) await starten(supabaseDb(client), name);
  };

  const { data } = await client.auth.getSession();
  await mitSitzung(data.session);
  client.auth.onAuthStateChange((_ereignis, session) => {
    if (session && !db) mitSitzung(session);
  });
})();

/* ===================== Handy-Menü und Passwort anzeigen ===================== */

// Am Handy ersetzt das Menü den Kopf-Knopf: Passwort und Abmelden laufen über dieselben Knöpfe wie am Computer
const menueSheet = $("[data-menue-sheet]");
$("[data-menue]").addEventListener("click", () => {
  $("[data-menue-name]").textContent = ich ? `Angemeldet als ${ich}` : "";
  $("[data-menue-passwort]").hidden = $("[data-passwort-setzen]").hidden;
  $("[data-menue-abmelden]").hidden = $("[data-abmelden]").hidden;
  $("[data-menue-push]").textContent = pushAn ? "Mitteilungen ausschalten" : "Mitteilungen bei neuen Anfragen";
  menueSheet.showModal();
});

menueSheet.addEventListener("click", (e) => {
  const ziel = e.target;
  if (ziel === menueSheet || ziel.closest("[data-menue-zu], [data-menue-link]")) {
    menueSheet.close();
    return;
  }
  if (ziel.closest("[data-menue-passwort]")) {
    menueSheet.close();
    $("[data-passwort-setzen]").click();
    return;
  }
  if (ziel.closest("[data-menue-push]")) {
    menueSheet.close();
    pushUmschalten();
    return;
  }
  if (ziel.closest("[data-menue-abmelden]")) {
    menueSheet.close();
    $("[data-abmelden]").click();
  }
});

// Passwort-Feld am Anmeldeformular: anzeigen oder verbergen
document.addEventListener("click", (e) => {
  const knopf = e.target.closest?.("[data-passwort-zeigen]");
  if (!knopf) return;
  const feld = knopf.parentElement.querySelector("input");
  const zeigen = feld.type === "password";
  feld.type = zeigen ? "text" : "password";
  knopf.setAttribute("aria-pressed", String(zeigen));
  knopf.setAttribute("aria-label", zeigen ? "Passwort verbergen" : "Passwort anzeigen");
});

hEinrichten();
