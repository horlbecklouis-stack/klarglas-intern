"use strict";

/* ===================== Grundlagen ===================== */

const CFG = window.KLARGLAS || {};
const TABELLEN = ["kunden", "auftraege", "notizen", "ausgaben", "auszahlungen", "aufgaben", "verfuegbarkeit", "einstellungen", "kalender", "blocker"];
const STATUS = [
  { id: "neu", name: "Neue Anfrage", farbe: "#2B5CFF" },
  { id: "kontakt", name: "In Kontakt", farbe: "#5B3FD6" },
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
const zustand = { kundenFilter: "alle", suche: "", geldZeitraum: "monat", geldStichtag: new Date(), geldPillePrev: null, aufgabenFilter: "offen", kalenderPruefung: null };
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
      { id: 1, slot_minuten: 60, slot_schritt: 30, vorlauf_stunden: 12, tage_voraus: 14, ...PREIS_STANDARD },
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
    const ergebnis = await db[aktion](t, ...rest);
    await laden(t);
    if (aktion === "remove" && t === "kunden") await Promise.all(["auftraege", "notizen", "aufgaben"].map(laden));
    return ergebnis;
  } catch (fehler) {
    zeigeToast(`Speichern hat nicht geklappt: ${fehler.message}`);
    throw fehler;
  }
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
  const gewinn = umsatz - ausgaben;
  return {
    umsatz,
    ausgaben,
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

const offeneErstattungen = () =>
  daten.ausgaben.filter((x) => x.bezahlt_von !== "Kasse" && !x.erstattet);

// Kanal eines Kunden: erst der Kanal des ersten Auftrags, sonst die Angabe beim Anlegen
const kanalAusKunde = (k) => (KANAELE[k?.quelle] ? k.quelle : null);
function kanalVonKunde(k) {
  const erster = auftraegeVon(k.id).sort((a, b) => auftragDatum(a) - auftragDatum(b))[0];
  return erster?.kanal || kanalAusKunde(k);
}

// Auszahlungen, die als Anteil am Gewinn zählen (Erstattungen nicht)
const istAnteil = (x) => x.art !== "erstattung" && !String(x.notiz || "").startsWith("Erstattung");

// 50/50: Der Gewinn wird immer geteilt, egal wer gearbeitet hat.
// verteilbar = Kasse - offene Erstattungen + schon ausgezahlte Anteile; Anteil = verteilbar / 2
function aufteilung() {
  const offen = offeneErstattungen();
  const anteile = daten.auszahlungen.filter(istAnteil);
  const summeAnteile = anteile.reduce((s, x) => s + Number(x.betrag), 0);
  const summeOffen = offen.reduce((s, x) => s + Number(x.betrag), 0);
  const verteilbar = kassenstand() - summeOffen + summeAnteile;
  const anteil = verteilbar / 2;
  const personen = PERSONEN.map((name) => {
    const bereitsAnteil = anteile.reduce(
      (s, x) => s + (x.an === name ? Number(x.betrag) : x.an === "Beide" ? Number(x.betrag) / 2 : 0),
      0
    );
    const erstattungOffen = offen.filter((x) => x.bezahlt_von === name).reduce((s, x) => s + Number(x.betrag), 0);
    return { name, anteil, bereitsAnteil, erstattungOffen, noch: anteil - bereitsAnteil + erstattungOffen };
  });
  const [a, b] = personen;
  const vorne = a.bereitsAnteil >= b.bereitsAnteil ? a : b;
  const hinten = vorne === a ? b : a;
  // Wer weniger Anteil ausgezahlt bekommen hat, bekommt den Unterschied zuerst
  const D = Math.round((vorne.bereitsAnteil - hinten.bereitsAnteil) * 100) / 100;
  return { verteilbar, anteil, personen, vorne, hinten, D };
}

const nochEintragen = () =>
  daten.auftraege
    .filter((a) => !istTermin(a) && !a.vorlaeufig && !a.abgesagt && zahl(a.bekommen) === null && a.datum && new Date(a.datum) < new Date())
    .sort((a, b) => new Date(a.datum) - new Date(b.datum));

const kommendeTermine = () =>
  daten.auftraege
    .filter((a) => !a.abgesagt && !a.vorlaeufig && a.datum && new Date(a.datum) >= new Date())
    .sort((a, b) => new Date(a.datum) - new Date(b.datum));

// Vorläufig ausgemacht, aber noch nicht fest: auch wenn der Tag schon vorbei ist, bleibt er hier stehen
const geplanteTermine = () =>
  daten.auftraege
    .filter((a) => a.vorlaeufig && !a.abgesagt && zahl(a.bekommen) === null)
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
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.5 3.5 5.3 3.5 8.5s-1.1 6-3.5 8.5c-2.4-2.5-3.5-5.3-3.5-8.5s1.1-6 3.5-8.5Z"/>',
};
const badge = (farbe, icon) => `<span class="badge badge--${farbe}" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[icon]}</svg></span>`;
const kartenTitel = (id, farbe, icon, titel) => `<h2 class="karte__titel" id="${id}">${badge(farbe, icon)}<span>${titel}</span></h2>`;

// Kontaktweg: Telefon, E-Mail, Website oder nebenan.de
const KANAELE = {
  telefon: { name: "Telefon", farbe: "#2B5CFF", icon: "kontakt" },
  email: { name: "E-Mail", farbe: "#5B3FD6", icon: "mail" },
  website: { name: "Website", farbe: "#D08A00", icon: "web" },
  nebenan: { name: "nebenan.de", farbe: "#1E9E5A", icon: "haus" },
};
const kanalName = (kanal) => KANAELE[kanal]?.name || "";
const kanalMarke = (kanal) => {
  const k = KANAELE[kanal];
  if (!k) return "";
  return `<span class="kanal-marke kanal-marke--${kanal}" role="img" title="${k.name}" aria-label="Kontakt über ${k.name}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k.icon]}</svg></span>`;
};

// Große Knöpfe für den Kontaktweg (Pflicht)
function kanalWahl(gewaehlt) {
  return `<fieldset class="kanal-wahl">
    <legend>Kontakt über</legend>
    <div class="kanal-wahl__reihe">
      ${Object.entries(KANAELE).map(([id, k]) => `<label class="kanal-wahl__knopf">
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
        <span class="zeile__unter">${d ? `wahrscheinlich ${esc(fmtTag.format(d))}, ${esc(fmtUhr.format(d))} Uhr` : "noch ohne Tag"}${istTermin(a) ? "" : ` · ${esc(a.leistung)}`}${vorbei ? ' · <span class="minus">Tag ist vorbei</span>' : ""}</span>
      </span>
    </button>
    <div class="geplant-zeile__aktionen">
      <button class="knopf knopf--klein knopf--voll" type="button" data-aktion="termin-fix" data-id="${esc(a.id)}">Fix machen</button>
      <button class="knopf knopf--klein knopf--leise" type="button" data-aktion="auftrag-bearbeiten" data-id="${esc(a.id)}">Ändern</button>
    </div>
  </li>`;
}

function eintragenZeile(a) {
  const k = kundeVon(a.kunde_id);
  return `<form class="eintragen" data-eintragen="${esc(a.id)}">
    <span class="zeile__haupt">
      <button class="zeile__titel zeile__titel--knopf" type="button" data-aktion="termin-karte" data-id="${esc(a.id)}">${kanalMarke(a.kanal)}${esc(k?.name || "Unbekannt")}</button>
      <span class="zeile__unter">${esc(fmtTag.format(new Date(a.datum)))} · ${esc(a.leistung)}${zahl(a.geschaetzt) !== null ? ` · geschätzt ${euro(a.geschaetzt)}` : ""}</span>
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
    a.faellig ? `${ueberfaellig ? '<span class="minus">überfällig · </span>' : ""}bis ${esc(fmtTag.format(new Date(a.faellig)))}` : "",
    k ? `<a href="#kunde/${esc(k.id)}">${esc(k.name)}</a>` : "",
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
function balken(gruppen, reihen) {
  const B = 640, H = 220, unten = 28, oben = 16;
  const max = Math.max(1, ...gruppen.flatMap((g) => reihen.map((r) => Math.abs(g.werte[r.id] || 0))));
  const breiteGruppe = B / Math.max(gruppen.length, 1);
  const breiteBalken = Math.min(26, (breiteGruppe * 0.7) / reihen.length);
  const hoehe = (w) => ((H - unten - oben) * Math.max(0, w)) / max;
  let svg = `<svg class="diagramm" viewBox="0 0 ${B} ${H}" role="img" aria-label="${esc(gruppen.map((g) => `${g.label}: ${reihen.map((r) => `${r.name} ${euro(g.werte[r.id] || 0)}`).join(", ")}`).join("; "))}">`;
  svg += `<line x1="0" x2="${B}" y1="${H - unten}" y2="${H - unten}" stroke="#E4E4E7" />`;
  gruppen.forEach((g, i) => {
    const start = i * breiteGruppe + (breiteGruppe - breiteBalken * reihen.length - 4 * (reihen.length - 1)) / 2;
    reihen.forEach((r, j) => {
      const w = g.werte[r.id] || 0;
      const h = hoehe(w);
      const x = start + j * (breiteBalken + 4);
      svg += `<rect x="${x.toFixed(1)}" y="${(H - unten - h).toFixed(1)}" width="${breiteBalken.toFixed(1)}" height="${Math.max(h, w ? 2 : 0).toFixed(1)}" rx="5" fill="${r.farbe}" />`;
    });
    svg += `<text x="${(i * breiteGruppe + breiteGruppe / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="13" fill="#5A6172" font-family="Figtree, sans-serif">${esc(g.label)}</text>`;
  });
  return `${svg}</svg><p class="legende">${reihen.map((r) => `<span style="--farbe:${r.farbe}">${esc(r.name)}</span>`).join("")}</p>`;
}

// Liniendiagramm als SVG für 12-Monats-Zeitreihen
function linie(punkte, opts = {}) {
  const { format = euro, mitProzent = false, treppe = false } = opts;
  if (!punkte || !punkte.length) return `<p class="leer">Noch keine Daten.</p>`;

  const B = 640, H = 220, unten = 28, oben = 16, seite = 40;
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
    svg += `<g class="diagramm__punkt"><circle cx="${x}" cy="${y}" r="14" fill="transparent" /><circle cx="${x}" cy="${y}" r="3.5" fill="#2B5CFF" />
      <title>${esc(p.titel || p.label)}: ${esc(format(p.wert))}${p.quote != null ? ` · Ø ${p.quote} %` : ""}</title></g>`;
    if (i % Math.ceil(punkte.length / 12) && i !== punkte.length - 1) return;
    svg += `<text x="${x}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#5A6172" font-family="Figtree, sans-serif">${esc(p.label)}</text>`;
  });

  // Wert über dem letzten Punkt
  const letzter = punkte[punkte.length - 1];
  const labelLetzt = mitProzent && letzter.quote != null ? `${format(letzter.wert)} · Ø ${letzter.quote} %` : format(letzter.wert);
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
    ...daten.auszahlungen.filter((x) => !seitDatum || new Date(x.datum) >= seitDatum).map((x) => ({
      art: "auszahlung", datum: new Date(x.datum), betrag: -Number(x.betrag), titel: `Auszahlung an ${x.an}`,
      unter: x.notiz || "", aktion: "auszahlung-bearbeiten", id: x.id,
    })),
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
  const aufgaben = daten.aufgaben.filter((a) => !a.erledigt).sort(nachFaelligkeit).slice(0, 5);
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
        const hell = { neu: "rgba(43, 92, 255, 0.08)", kontakt: "#f0ebff", geplant: "#fbe9e7", termin: "#fff4e0", erledigt: "#e6f5ee", stamm: "#e8eaf0", abgesagt: "#f4f5f7" }[s.id];
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
  const arten = Object.entries(KANAELE).concat(zaehl.ohne ? [["ohne", OHNE_KANAL]] : []);
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
  return (a.faellig || "9999") < (b.faellig || "9999") ? -1 : (a.faellig || "9999") > (b.faellig || "9999") ? 1 : 0;
}

function naechsterTermin(kundeId) {
  return kommendeTermine().find((a) => a.kunde_id === kundeId);
}

function ansichtKunden() {
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
function verlaufEintrag(n) {
  const quelle = n.quelle && n.quelle !== "notiz" ? NACHRICHT_QUELLEN[n.quelle] : "";
  const text = String(n.text || "");
  const lang = text.length > 280 || text.split("\n").length > 5;
  const inhaltText = lang
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
  const handy = istHandy();
  const termine = kommendeTermine().slice(0, handy ? 8 : 10);
  let lesend = 0;
  const kalender = sichtbareKalender().map((k) => ({ ...k, farbe: kalenderFarbe(k, k.art === "eintragen" ? 0 : lesend++) }));
  const quellen = kalender.map((k) => `src=${encodeURIComponent(k.kalender_id)}&color=${encodeURIComponent(k.farbe)}`).join("&");
  const legende = kalender.length > 1
    ? `<ul class="kal-legende" aria-label="Angezeigte Kalender">${kalender.map((k) => `<li><span class="kal-legende__punkt" style="background:${k.farbe}"></span>${esc(k.name)}<span class="leise"> · ${k.art === "eintragen" ? "Termine" : "nur lesen"}</span></li>`).join("")}</ul>`
    : "";
  const einbetten = kalender.length
    ? `${legende}<iframe class="kalender" title="Google-Kalender" loading="lazy"
        src="https://calendar.google.com/calendar/embed?${quellen}&ctz=Europe%2FBerlin&hl=de&mode=${window.matchMedia("(min-width: 900px)").matches ? "WEEK" : "AGENDA"}&wkst=2&showTitle=0&showPrint=0&showCalendars=0&showTz=0"></iframe>
       <p class="hinweis">Leer oder fehlt ein Kalender? Dann im selben Browser bei Google mit einem Konto anmelden, das diese Kalender sehen darf.</p>`
    : `<section class="karte"><h2>Google-Kalender verbinden</h2>
        <p class="leise">Unter <a href="#zeiten">Wann wir können</a> → „+ Kalender hinzufügen“ euren Kalender eintragen.</p></section>`;
  return `
    <div class="kopfzeile"><div><h1>Kalender</h1><p class="leise">Termine und Blocker aus allen verbundenen Kalendern</p></div></div>
    ${handy ? terminListeHandy(termine) : ""}
    ${einbetten}
    <section class="karte" ${handy ? "hidden" : ""} aria-labelledby="t-kommend">
      ${kartenTitel("t-kommend", "blau", "uhr", "Kommende Aufträge")}
      ${termine.length ? `<ul class="liste">${termine.map(terminZeile).join("")}</ul>` : `<p class="leer">Keine Termine eingetragen.</p>`}
    </section>`;
}

// Zeitreihe für das Popup: 7 Tage der Woche, 12 Monate bis zum Stichtag oder die 12 Monate des Jahres
function zeitreihe(zeitraum, stichtag) {
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
  return { untertitel: "letzte 12 Monate", punkte: Array.from({ length: 12 }, (_, i) => monatPunkt(new Date(j, m - 11 + i, 1))) };
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

  const { untertitel, punkte } = zeitreihe(zeitraum, stichtag);
  const betitel = (name) => `${name} · ${untertitel}`;
  const reihe = (wertVon) => punkte.map((p) => ({ label: p.label, titel: p.titel, ...wertVon(p.von, p.bis) }));
  const feld = (name) => reihe((von, bis) => ({ wert: zahlenFuer(von, bis)[name] }));

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
  if (zeige === "ausgaben") {
    return { titel: betitel("Ausgaben"), wert: euro(m.ausgaben), diagramm: linie(feld("ausgaben"), { format: euro }) };
  }
  if (zeige === "gewinn") {
    return { titel: betitel("Gewinn"), wert: euro(m.gewinn), diagramm: linie(feld("gewinn"), { format: euro }) };
  }
  return { titel: betitel("Umsatz"), wert: euro(m.umsatz), diagramm: linie(feld("umsatz"), { format: euro }) };
}

// Auf dem Handy immer der Monat; am Computer der gewählte Zeitraum
const aktuellerZeitraum = () => (istHandy() ? "monat" : zustand.geldZeitraum);

// Aufteilung 50/50 (nur Desktop): wer bekommt noch wie viel
function aufteilungKarte() {
  const t = aufteilung();
  const kasse = kassenstand();
  const farbe = { Louis: "blau", Lukas: "violett" };
  const kachelFuer = (p) => {
    const rund = Math.round(p.noch * 100) / 100;
    if (rund === 0) return kachel(p.name, euro(0), "alles ausgeglichen", false, null, farbe[p.name]);
    if (rund > 0) return kachel(p.name, euro(rund), "bekommt noch", false, null, farbe[p.name]);
    return kachel(p.name, `<span class="minus">${euro(-rund)}</span>`, `<span class="minus">hat zu viel</span>`, false, null, farbe[p.name]);
  };
  const zeile = (titel, wert) =>
    `<div class="aufteilung__zeile"><span class="leise">${titel}</span>${t.personen.map((p) => `<span>${euro(wert(p))}</span>`).join("")}</div>`;
  const ausgeglichen = t.personen.every((p) => Math.abs(p.noch) < 0.005);
  let satz = "Bisher haben beide gleich viel ausgezahlt.";
  if (ausgeglichen) satz = "Alles ausgeglichen.";
  else if (t.D >= 0.005) satz = `${t.vorne.name} hat sich ${euro(t.D)} mehr ausgezahlt – die nächsten ${euro(t.D)} gehen an ${t.hinten.name}.`;
  if (t.D > kasse + 0.005) satz += " Dafür reicht die Kasse gerade noch nicht.";
  const ausgleich =
    t.D >= 0.005 && t.D <= kasse + 0.005
      ? `<button class="knopf knopf--voll knopf--klein" type="button" data-aktion="ausgleich">Ausgleich auszahlen</button>`
      : "";
  return `<section class="karte" aria-labelledby="t-aufteilung">
    ${kartenTitel("t-aufteilung", "violett", "zahl", "Aufteilung 50/50")}
    <div class="aufteilung__kacheln">${t.personen.map(kachelFuer).join("")}</div>
    <div class="aufteilung__zeilen">
      <div class="aufteilung__zeile aufteilung__zeile--kopf"><span></span>${t.personen.map((p) => `<span>${esc(p.name)}</span>`).join("")}</div>
      ${zeile("Anteil gesamt", (p) => p.anteil)}
      ${zeile("schon ausgezahlt", (p) => p.bereitsAnteil)}
      ${zeile("Erstattung offen", (p) => p.erstattungOffen)}
    </div>
    <p class="aufteilung__satz">${esc(satz)}</p>
    ${ausgleich}
    <p class="hinweis">Der Gewinn wird immer 50/50 geteilt, egal wer gearbeitet hat. Erstattungen zählen nicht als Anteil.</p>
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
  const schritt = { woche: ["Vorwoche", "Nächste Woche"], monat: ["Vormonat", "Nächster Monat"], jahr: ["Vorjahr", "Nächstes Jahr"] }[aktuellerZeitraum()];
  const zeitraumNamen = { woche: "Woche", monat: "Monat", jahr: "Jahr" };

  return `
    <div class="kopfzeile">
      <div><h1>Geld</h1><p class="leise">Alles bar, alles in einer Kasse</p></div>
      <div class="knopfreihe">
        <button class="knopf" type="button" data-aktion="auszahlung-neu">Auszahlung</button>
        <button class="knopf knopf--voll" type="button" data-aktion="ausgabe-neu">Ausgabe eintragen</button>
      </div>
    </div>

    <div class="zeitraum">
      <div class="segment" role="group" aria-label="Zeitraum wählen">
        <span class="segment__pille" aria-hidden="true" data-ziel="${ZEITRAUM_POS[z.geldZeitraum]}" style="--i:${z.geldPillePrev ?? ZEITRAUM_POS[z.geldZeitraum]}"></span>
        ${Object.keys(ZEITRAUM_POS).map((w) => `<button class="segment__knopf" type="button" aria-pressed="${z.geldZeitraum === w}" data-aktion="zeitraum" data-wert="${w}">${zeitraumNamen[w]}</button>`).join("")}
      </div>
      <div class="zeitraum__nav">
        <button class="knopf knopf--klein knopf--leise" type="button" data-aktion="schritt" data-wert="-1" aria-label="${schritt[0]}">‹</button>
        <h2 class="zeitraum__titel">${esc(g.label)}</h2>
        <button class="knopf knopf--klein knopf--leise" type="button" data-aktion="schritt" data-wert="1" aria-label="${schritt[1]}">›</button>
      </div>
    </div>

    <div class="${handy ? "raster raster--geld-handy" : "raster raster--kacheln raster--tabs"}" role="group" aria-label="Kennzahl für das Diagramm wählen">
      ${tabs.map(([id, titel, wert, info, farbe]) => `<button class="kachel kachel--tab kachel--${farbe}${handy && id === "kasse" ? " kachel--gross" : ""}" type="button" data-aktion="geld-tab" data-wert="${id}">
        <span class="kachel__titel">${titel}</span>
        <span class="kachel__wert">${wert}</span>
        ${info ? `<span class="kachel__info">${info}</span>` : ""}
      </button>`).join("")}
    </div>

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
  const liste = daten.aufgaben
    .filter((a) => (f === "erledigt" ? a.erledigt : !a.erledigt))
    .filter((a) => !PERSONEN.includes(f) || a.zustaendig === f || a.zustaendig === "Beide")
    .sort(f === "erledigt" ? (a, b) => new Date(b.erstellt) - new Date(a.erstellt) : nachFaelligkeit);
  const filter = [["offen", "Offen"], ["Louis", "Louis"], ["Lukas", "Lukas"], ["erledigt", "Erledigt"]];
  return `
    <div class="kopfzeile">
      <div><h1>Aufgaben</h1><p class="leise">${daten.aufgaben.filter((a) => !a.erledigt).length} offen</p></div>
      <button class="knopf knopf--voll" type="button" data-aktion="aufgabe-neu">Neue Aufgabe</button>
    </div>
    <div class="chips" role="group" aria-label="Aufgaben filtern">
      ${filter.map(([wert, name]) => `<button class="chip" type="button" aria-pressed="${f === wert}" data-aktion="aufgaben-filter" data-wert="${wert}">${name}</button>`).join("")}
    </div>
    <section class="karte">
      ${liste.length ? `<ul class="liste">${liste.map(aufgabeZeile).join("")}</ul>` : `<p class="leer">${f === "erledigt" ? "Noch nichts erledigt." : "Nichts offen. Stark."}</p>`}
    </section>
    ${istIos ? `<p class="hinweis">„In OutPost“ legt die Aufgabe in deiner Erinnerungen-Liste „Klar Glas“ an.</p>` : ""}`;
}

// Einstellungen (nur am Computer verlinkt): Preise und Stundenlohn
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
      <label class="feld"><span>Termindauer (Minuten)</span><input type="number" class="eingabe" value="${einstell.slot_minuten}" min="15" step="15" data-einstell="true" data-einstell-field="slot_minuten" /></label>
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

  const ansichten = { uebersicht: ansichtUebersicht, kunden: ansichtKunden, kunde: () => ansichtKunde(id), kalender: ansichtKalender, geld: ansichtGeld, aufgaben: ansichtAufgaben, zeiten: ansichtZeiten, einstellungen: ansichtEinstellungen };
  inhalt.innerHTML = (ansichten[bereich] || ansichtUebersicht)();
  // Die Pille im Zeitraum-Schalter gleitet von der alten Stufe zur neuen
  const pille = $(".segment__pille", inhalt);
  if (pille) {
    pille.offsetWidth;
    pille.style.setProperty("--i", pille.dataset.ziel);
  }
  zustand.geldPillePrev = null;

  const navZiel = bereich === "kunde" ? "kunden" : bereich;
  document.querySelectorAll("[data-nav] a").forEach((a) => {
    if (a.dataset.ziel === navZiel) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  const zeitenLink = $(".kopf__zeiten");
  if (bereich === "zeiten") zeitenLink.setAttribute("aria-current", "page");
  else zeitenLink.removeAttribute("aria-current");
  const einstLink = $(".kopf__einst");
  if (bereich === "einstellungen") einstLink.setAttribute("aria-current", "page");
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

function oeffneDialog({ titel, felder, knopf = "Speichern", absenden, entfernen, nachOeffnen }) {
  dialogForm.innerHTML = `
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
  if (entfernen) {
    $("[data-dialog-entfernen]", dialogForm).onclick = async () => {
      if (!confirm("Wirklich löschen? Das lässt sich nicht rückgängig machen.")) return;
      await entfernen();
      dialog.close();
      render();
      karteZurueckOeffnen();
    };
  }
  dialog.showModal();
  nachOeffnen?.(dialogForm);
  const erstes = dialogForm.querySelector("input, select, textarea");
  erstes?.focus();
}

dialogForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!dialogAbsenden) return;
  const knopf = dialogForm.querySelector("[type=submit]");
  knopf.disabled = true;
  try {
    await dialogAbsenden(Object.fromEntries(new FormData(dialogForm).entries()), dialogForm);
    dialog.close();
    render();
    karteZurueckOeffnen();
  } catch (fehler) {
    $("[data-dialog-fehler]", dialogForm).textContent = fehler.message;
  } finally {
    knopf.disabled = false;
  }
});

dialog.addEventListener("close", () => wartetAufRender && render());

/* ===================== Diagramm-Popup (Geld) ===================== */

const diagrammDialog = $("[data-diagramm]");

function oeffneDiagramm(zeige) {
  const { titel, wert, diagramm } = diagrammFuer(zeige, aktuellerZeitraum(), zustand.geldStichtag);
  $("[data-diagramm-inhalt]", diagrammDialog).innerHTML = `
    <button class="diagramm-popup__zu" type="button" data-diagramm-zu aria-label="Schließen">×</button>
    <h2 class="diagramm-popup__titel" id="diagramm-titel">${esc(titel)}</h2>
    <p class="diagramm-popup__wert">${esc(wert)}</p>
    <div class="diagramm-popup__bild">${diagramm}</div>`;
  if (!diagrammDialog.open) diagrammDialog.showModal();
}

// Klick auf den Hintergrund (das Dialog-Element selbst) oder auf den Schließen-Knopf schließt
diagrammDialog.addEventListener("click", (e) => {
  if (e.target === diagrammDialog || e.target.closest("[data-diagramm-zu]")) diagrammDialog.close();
});

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

function dialogAuftrag(a = {}, kundeId = null) {
  const kid = a.kunde_id || kundeId;
  const kunden = [...daten.kunden].sort((x, y) => x.name.localeCompare(y.name, "de"));
  if (!kunden.length) {
    zeigeToast("Leg zuerst einen Kunden an.");
    return;
  }
  const leistung = a.leistung || "Fensterreinigung";
  const p = preise();
  const preisart = a.preisart || "stunden";
  const kanalVorbelegt = a.kanal || (a.id ? null : kanalAusKunde(kundeVon(kid)));
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
      <div class="feldreihe">
        <label class="feld"><span data-geschaetzt-label>Geschätzter Preis (€)</span><input name="geschaetzt" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(a.geschaetzt ?? "")}" data-geschaetzt /></label>
        <label class="feld"><span>Wirklich bekommen (€)</span><input name="bekommen" type="number" inputmode="decimal" min="0" step="0.5" value="${esc(a.bekommen ?? "")}" placeholder="nach dem Termin" /></label>
      </div>
      <p class="hinweis" data-schaetz-hinweis></p>
      ${vorlaeufigSchalter(a)}
      ${kanalWahl(kanalVorbelegt)}
      <label class="feld"><span>Notizen zum Auftrag</span><textarea name="notiz" rows="3" placeholder="Zum Beispiel: Hund im Garten, Leiter mitbringen, Schlüssel beim Nachbarn">${esc(a.notiz)}</textarea></label>
      ${a.id ? `<label class="feld" style="grid-template-columns:auto 1fr;align-items:center;gap:.6rem"><input type="checkbox" name="abgesagt" ${a.abgesagt ? "checked" : ""} style="width:22px;min-height:22px" /><span>Abgesagt</span></label>` : ""}`,
    nachOeffnen: (form) => {
      let vonHand = a.id && zahl(a.geschaetzt) !== null && zahl(a.geschaetzt) !== schaetzen(a);
      const feld = $("[data-geschaetzt]", form);
      const aktualisieren = () => {
        const werte = Object.fromEntries(new FormData(form).entries());
        const fensterArt = werte.leistung === "Fensterreinigung";
        $("[data-nur-fenster]", form).hidden = !fensterArt;
        const fest = !fensterArt && werte.preisart === "fest";
        $("[data-nur-stunden]", form).hidden = fensterArt;
        $("[data-nur-stundenlohn]", form).hidden = fensterArt || fest;
        $("[data-geschaetzt-label]", form).textContent = fest ? "Festpreis (€)" : "Geschätzter Preis (€)";
        const s = schaetzen(werte);
        const satz = zahl(werte.stundensatz) ?? p.stundensatz;
        $("[data-schaetz-hinweis]", form).textContent = fest
          ? "Festpreis: Betrag oben direkt eintragen."
          : s === null ? "" : `Rechnung: ${fensterArt ? `${werte.fenster_normal || 0} × ${euro(p.preis_normal)} + ${werte.fenster_boden || 0} × ${euro(p.preis_boden)}, mindestens ${euro(p.mindestpreis)}` : `${Number(werte.stunden).toLocaleString("de-DE")} h × ${euro(satz)}`} = ${euro(s)}`;
        if (!vonHand && s !== null) feld.value = s;
      };
      feld.addEventListener("input", () => (vonHand = true));
      form.addEventListener("input", (e) => e.target !== feld && aktualisieren());
      aktualisieren();
    },
    absenden: async (f) => {
      if (!f.kanal) throw new Error("Bitte wähle, wie der Kunde auf uns zukam.");
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
        abgesagt: Boolean(f.abgesagt),
        kanal: f.kanal,
        vorlaeufig: Boolean(f.vorlaeufig) && Boolean(f.datum),
        notiz: (f.notiz || "").trim() || null,
      };
      let gespeichert;
      if (a.id) {
        gespeichert = await aendern("auftraege", a.id, zeile);
        if (zahl(a.bekommen) === null && zeile.bekommen !== null) await nachBezahlung(zeile.kunde_id, zeile);
        else if (zeile.datum && (zeile.datum !== a.datum || zeile.vorlaeufig !== Boolean(a.vorlaeufig))) await statusNachTermin(zeile.kunde_id, zeile);
      } else {
        gespeichert = await neu("auftraege", zeile);
        if (zeile.bekommen !== null) await nachBezahlung(zeile.kunde_id, zeile);
        else await statusNachTermin(zeile.kunde_id, zeile);
      }
      kalenderAbgleichen(gespeichert?.id || a.id);
    },
    entfernen: a.id ? () => auftragLoeschen(a) : null,
  });
}

// Schalter „Noch nicht bestätigt“: ungefähr ausgemacht, steht aber noch nicht fest
function vorlaeufigSchalter(a) {
  return `<label class="schalter-zeile">
    <input type="checkbox" name="vorlaeufig" ${a.vorlaeufig ? "checked" : ""} />
    <span><b>Noch nicht bestätigt</b><small>Ungefähr ausgemacht, z. B. „wahrscheinlich Samstag 16 Uhr“. Steht als „Termin geplant“ und mit ? im Kalender.</small></span>
  </label>`;
}

// Kunde rückt mit einem Termin weiter: vorläufig → „Termin geplant“, fest → „Termin steht“
async function statusNachTermin(kundeId, zeile) {
  const k = kundeVon(kundeId);
  if (!k || !zeile.datum || zeile.abgesagt) return;
  const ziel = zeile.vorlaeufig ? "geplant" : "termin";
  const darf = zeile.vorlaeufig ? ["neu", "kontakt", "erledigt", "abgesagt"] : ["neu", "kontakt", "geplant", "erledigt", "abgesagt"];
  if (k.status === ziel || !darf.includes(k.status)) return;
  await aendern("kunden", k.id, { status: ziel });
  await notiz(k.id, `${zeile.vorlaeufig ? "Vorläufiger Termin" : "Termin"} am ${fmtTag.format(new Date(zeile.datum))}, ${fmtUhr.format(new Date(zeile.datum))} Uhr · Status → ${STATUS_NAME[ziel]}`);
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
      if (zeile.kunde_id && (!a.id || zeile.datum !== a.datum || zeile.vorlaeufig !== Boolean(a.vorlaeufig))) await statusNachTermin(zeile.kunde_id, zeile);
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
  // Ab 3 bezahlten Besuchen wird man Stammkunde
  const besuche = auftraegeVon(kundeId).filter((x) => zahl(x.bekommen) !== null).length;
  if (besuche >= STAMM_AB && k.status !== "stamm") {
    await aendern("kunden", kundeId, { status: "stamm" });
    await notiz(kundeId, `Status → Stammkunde (${besuche}. Besuch)`);
  } else if (k.status !== "stamm" && k.status !== "erledigt") {
    await aendern("kunden", kundeId, { status: "erledigt" });
  }
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
        <label class="feld"><span>Bezahlt von</span><select name="bezahlt_von">${optionen([["Kasse", "Unternehmenskasse"], ...PERSONEN.map((p) => [p, `${p} (privat ausgelegt)`])], x.bezahlt_von || "Kasse")}</select></label>
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
    titel: x.id ? "Auszahlung bearbeiten" : "Auszahlung aus der Kasse",
    felder: `
      <div class="feldreihe">
        <label class="feld"><span>Betrag (€)</span><input name="betrag" type="number" inputmode="decimal" min="0" step="0.01" required value="${esc(x.betrag ?? "")}" /></label>
        <label class="feld"><span>Datum</span><input name="datum" type="date" required value="${esc(x.datum || heuteIso())}" /></label>
      </div>
      <label class="feld"><span>An</span><select name="an">${optionen([...PERSONEN, ["Beide", "Louis und Lukas (je die Hälfte)"]], x.an || ich)}</select></label>
      <label class="feld"><span>Notiz</span><input name="notiz" value="${esc(x.notiz)}" /></label>
      <p class="hinweis">Kassenstand gerade: ${euro(kassenstand())}</p>`,
    absenden: async (f) => {
      const zeile = { betrag: Number(f.betrag), datum: f.datum, an: f.an, notiz: f.notiz.trim() || null };
      if (x.id) await aendern("auszahlungen", x.id, zeile);
      else await neu("auszahlungen", { ...zeile, art: "anteil" });
    },
    entfernen: x.id ? () => loeschen("auszahlungen", x.id) : null,
  });
}

function dialogAufgabe(a = {}) {
  const kunden = [...daten.kunden].sort((x, y) => x.name.localeCompare(y.name, "de"));
  oeffneDialog({
    titel: a.id ? "Aufgabe bearbeiten" : "Neue Aufgabe",
    felder: `
      <label class="feld"><span>Was ist zu tun?</span><input name="titel" required value="${esc(a.titel)}" placeholder="Zum Beispiel: Flyer im Märchenviertel verteilen" /></label>
      <div class="feldreihe">
        <label class="feld"><span>Wer</span><select name="zustaendig">${optionen(["Beide", ...PERSONEN], a.zustaendig || "Beide")}</select></label>
        <label class="feld"><span>Bis wann</span><input name="faellig" type="date" value="${esc(a.faellig || "")}" /></label>
      </div>
      <label class="feld"><span>Zu Kunde (optional)</span><select name="kunde_id"><option value="">–</option>${optionen(kunden.map((k) => [k.id, k.name]), a.kunde_id)}</select></label>`,
    absenden: async (f) => {
      const zeile = { titel: f.titel.trim(), zustaendig: f.zustaendig, faellig: f.faellig || null, kunde_id: f.kunde_id || null };
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

// Trinkgeld-Hinweis unter dem Betragsfeld, live beim Tippen
function tgTextFuer(betrag, geschaetzt) {
  if (betrag === null) return "";
  const tg = geschaetzt > 0 ? Math.max(0, Math.round((betrag - geschaetzt) * 100) / 100) : 0;
  const prozent = geschaetzt > 0 ? Math.round((tg / geschaetzt) * 100) : null;
  return `davon Trinkgeld: <strong>${euro(tg)}</strong>${prozent !== null ? ` (${prozent} %)` : ""}`;
}

const d0 = (a) => Boolean(a.datum);
function terminStatusChip(a) {
  let text = "geplant";
  let klasse = "status--kontakt";
  if (a.abgesagt) [text, klasse] = ["abgesagt", "status--abgesagt"];
  else if (a.vorlaeufig) [text, klasse] = ["vorläufig", "status--geplant"];
  else if (istTermin(a)) [text, klasse] = [d0(a) ? "fest" : "offen", "status--neu"];
  else if (zahl(a.bekommen) !== null) [text, klasse] = ["erledigt", "status--erledigt"];
  else if (a.termin_status === "angefragt") [text, klasse] = ["angefragt", "status--termin"];
  else if (a.termin_status === "bestaetigt") [text, klasse] = ["bestätigt", "status--neu"];
  else if (a.termin_status === "abgelehnt") [text, klasse] = ["abgelehnt", "status--abgesagt"];
  return `<span class="status ${klasse}">${text}</span>`;
}

// Eine Zeile im Infoblock: Icon links, Begriff und Wert rechts (dl > div > dt + dd)
const tkInfo = (icon, titel, wert) => `<div class="tk-info">
    <span class="tk-info__icon" aria-hidden="true"><svg viewBox="0 0 24 24">${icon}</svg></span>
    <dt>${titel}</dt>
    <dd>${wert}</dd>
  </div>`;

// Runder Schnellknopf: Kreis mit Icon, Beschriftung darunter
const tkKreis = (farbe, icon, titel) => `<span class="tk-rund__kreis tk-rund__kreis--${farbe}" aria-hidden="true"><svg viewBox="0 0 24 24">${icon}</svg></span><span class="tk-rund__titel">${titel}</span>`;

// Countdown in der Terminkarte: "heute, in 3 Std.", "morgen", "in 2 Tagen", "vor 3 Tagen"
function tkCountdown(d) {
  if (!d) return "";
  const jetzt = new Date();
  const tage = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate())) / 86400000);
  if (tage === 0) {
    const std = (d - jetzt) / 3600000;
    if (std >= 1) return `heute, in ${Math.round(std)} Std.`;
    if (std > 0) return "heute, gleich";
    return "heute";
  }
  if (tage === 1) return "morgen";
  if (tage === -1) return "gestern";
  return tage > 0 ? `in ${tage} Tagen` : `vor ${-tage} Tagen`;
}

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

// Gruppe mit Überschrift; ohne Zeilen gar keine Gruppe
const tkGruppe = (titel, zeilen) => {
  const da = zeilen.filter(Boolean);
  return da.length ? `<section class="tk-gruppe"><h3 class="tk-gruppe__titel">${titel}</h3><dl class="tk-infos">${da.join("")}</dl></section>` : "";
};

function terminkarteInhalt(a, { erfolg = false, bearbeiten = false } = {}) {
  const k = kundeVon(a.kunde_id);
  const d = a.datum ? new Date(a.datum) : null;
  const bezahlt = zahl(a.bekommen) !== null;
  const zukunft = d !== null && d > new Date();
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
  const besuche = k ? auftraegeVon(k.id).filter((x) => zahl(x.bekommen) !== null) : [];
  const quote = k ? trinkgeldQuote(auftraegeVon(k.id)) : null;
  // Uhrzeit von–bis, wenn eine Dauer eingetragen ist
  const dauerMin = istTermin(a) ? Number(a.dauer_min) || 0 : stunden ? stunden * 60 : 0;
  const ende = d && dauerMin ? new Date(d.getTime() + dauerMin * 60000) : null;
  const uhr = d ? `${fmtUhr.format(d)}${ende ? ` – ${fmtUhr.format(ende)}` : ""}` : "";

  const kopf = `<header class="tk-kopf">
      <button class="tk-bearbeiten" type="button" data-aktion="auftrag-bearbeiten" data-id="${esc(a.id)}" data-tk-bearbeiten aria-label="${istTermin(a) ? "Termin" : "Auftrag"} bearbeiten">
        <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.stift}</svg><span>Bearbeiten</span>
      </button>
      <div class="tk-kopf__status">
        ${terminStatusChip(a)}
        ${d ? `<span class="tk-countdown">${esc(tkCountdown(d))}</span>` : ""}
      </div>
      <p class="tk-wochentag">${d ? esc(fmtWochentag.format(d)) : "Ohne Termin"}</p>
      <h2 class="tk-datum" id="tk-titel">${d ? esc(fmtTagMonat.format(d)) : "Termin offen"}</h2>
      ${uhr ? `<p class="tk-uhr">${esc(uhr)}<span> Uhr</span></p>` : ""}
    </header>`;

  const kunde = k
    ? `<a class="tk-kunde" href="#kunde/${esc(k.id)}" data-tk-kunde>
        <span class="tk-avatar" aria-hidden="true">${esc(tkInitialen(k.name))}</span>
        <span class="tk-kunde__text">
          <span class="tk-kunde__name">${esc(k.name)}</span>
          <span class="tk-kunde__meta">
            ${k.status === "stamm" ? `<span class="tk-stamm">${badge("navy", "kunden")}Stammkunde</span>` : ""}
            <span>${besuche.length} ${besuche.length === 1 ? "bezahlter Besuch" : "bezahlte Besuche"}${quote !== null ? ` · Ø ${quote} % Trinkgeld` : ""}</span>
          </span>
          <span class="tk-kunde__zur">Kundenseite öffnen</span>
        </span>
      </a>`
    : `<p class="tk-kunde tk-kunde--leer">${istTermin(a) ? `${esc(auftragTitel(a))} ohne Kunde` : "Kunde nicht mehr vorhanden"}</p>`;

  // Anrufen, Mail, Route: immer drei Kacheln gleicher Größe
  const schnell = `<div class="tk-schnell">
      ${tkSchnell(!!tel, `tel:${tel}`, "blau", ICONS.kontakt, "Anrufen")}
      ${tkSchnell(!!k?.email, `mailto:${k?.email || ""}`, "violett", ICONS.mail, "Mail")}
      ${tkSchnell(!!adresse, karte, "gruen", TK_ICON.pin, "Route", ' target="_blank" rel="noopener"')}
      ${k?.nebenan_link ? tkSchnell(true, nebenanUrl(k.nebenan_link), "nebenan", ICONS.haus, "nebenan.de", ' target="_blank" rel="noopener"') : ""}
    </div>`;

  const notizAuftrag = a.notiz
    ? `<section class="tk-notiz" aria-label="Notizen"><h3 class="tk-gruppe__titel">Notizen</h3><p>${esc(a.notiz)}</p></section>`
    : "";

  const auftrag = istTermin(a)
    ? tkGruppe("Termin", [
        tkInfo(ICONS.termin, "Art", esc(auftragTitel(a))),
        a.dauer_min && tkInfo(ICONS.uhr, "Dauer", `${Number(a.dauer_min)} Min.`),
      ])
    : tkGruppe("Auftrag", [
    a.leistung && tkInfo(ICONS.aufgabe, "Leistung", esc(a.leistung)),
    fensterN + fensterB > 0 && tkInfo(TK_ICON.fenster, "Umfang", `${fensterN} normale · ${fensterB} bodentiefe`),
    stunden !== null && tkInfo(ICONS.uhr, "Dauer", `${esc(String(stunden).replace(".", ","))} Std.`),
  ]);

  const kontakt = tkGruppe("Kontakt", [
    k?.adresse && tkInfo(TK_ICON.pin, "Adresse", esc(k.adresse)),
    k?.telefon && tkInfo(ICONS.kontakt, "Telefon", esc(k.telefon)),
    k?.email && tkInfo(ICONS.mail, "E-Mail", esc(k.email)),
    KANAELE[a.kanal] && tkInfo(ICONS.web, "Kontakt über", `${kanalMarke(a.kanal)}${esc(kanalName(a.kanal))}`),
  ]);

  const verlauf = tkGruppe("Verlauf", [
    k?.weiter && tkInfo(ICONS.bewegung, "Wie geht's weiter?", esc(k.weiter)),
    notiz && tkInfo(ICONS.stift, "Letzte Notiz", `${esc(notiz.text)} <small class="leise">· ${esc(fmtDatum.format(new Date(notiz.erstellt)))}</small>`),
  ]);

  // Vorläufig: oben ein deutlicher Hinweis mit „Fix machen“
  const vorlaeufig = a.vorlaeufig && !a.abgesagt
    ? `<section class="tk-vorlaeufig">
        <p><b>Noch nicht bestätigt.</b> Ungefähr ausgemacht – erst „Fix machen“, wenn der Kunde zugesagt hat.</p>
        <button class="knopf knopf--voll" type="button" data-aktion="termin-fix" data-id="${esc(a.id)}">Fix machen</button>
      </section>`
    : "";

  // Bezahlt-Bereich: eigene Ebene, das Wichtigste auf der Karte
  let geld;
  if (istTermin(a)) {
    geld = "";
  } else if (bezahlt && !bearbeiten) {
    const tg = trinkgeld(a);
    geld = `<section class="tk-geld tk-geld--bezahlt" aria-labelledby="tk-geld-titel">
      <div class="tk-geld__zeile">
        <span class="tk-haken${erfolg ? " tk-haken--neu" : ""}" aria-hidden="true"><svg viewBox="0 0 24 24">${TK_ICON.haken}</svg></span>
        <div class="tk-geld__text">
          <p class="tk-geld__titel" id="tk-geld-titel">Bezahlt: ${euro(a.bekommen)}</p>
          <p class="tk-geld__werte">${geschaetzt !== null ? `Geschätzt ${euro(geschaetzt)}` : "Kein Schätzwert"}${tg ? ` · <strong>+${euro(tg)} Trinkgeld</strong>` : ""}</p>
          ${erfolg ? `<p class="tk-geld__ok" role="status">${euro(a.bekommen)} eingetragen</p>` : ""}
        </div>
      </div>
      <button class="knopf knopf--klein tk-aendern" type="button" data-tk-aendern>Betrag ändern</button>
    </section>`;
  } else {
    const leise = zukunft && !bezahlt && !bearbeiten;
    const titel = bearbeiten ? "Betrag ändern" : leise ? "Nach dem Termin eintragen" : "Wirklich bekommen?";
    const wert = bezahlt ? zahl(a.bekommen) : geschaetzt;
    const text = wert === null ? "" : String(wert).replace(".", ",");
    geld = `<section class="tk-geld${leise ? " tk-geld--leise" : ""}" aria-labelledby="tk-geld-titel">
      <h3 class="tk-geld__titel" id="tk-geld-titel">${titel}</h3>
      <form class="tk-geld__form" data-tk-form>
        <div class="tk-vergleich">
          <div class="tk-vergleich__schaetz">
            <span class="tk-vergleich__label">Geschätzt</span>
            <span class="tk-vergleich__wert">${geschaetzt !== null ? esc(euro(geschaetzt)) : "–"}</span>
          </div>
          <label class="tk-betrag">
            <span class="tk-vergleich__label">Wirklich bekommen</span>
            <span class="tk-betrag__box">
              <input class="tk-betrag__feld" name="bekommen" type="text" inputmode="decimal" autocomplete="off" value="${esc(text)}" aria-label="Wirklich bekommen in Euro" data-tk-betrag />
              <span class="tk-betrag__euro" aria-hidden="true">€</span>
            </span>
          </label>
        </div>
        <p class="tk-tg" data-tk-tg>${tgTextFuer(betragLesen(text), geschaetzt)}</p>
        <p class="meldung minus" data-tk-fehler role="alert"></p>
        <div class="tk-aktionen">
          ${bearbeiten ? `<button class="knopf knopf--leise" type="button" data-tk-abbrechen>Abbrechen</button>` : ""}
          <button class="knopf knopf--voll tk-speichern" type="submit">Speichern</button>
        </div>
      </form>
    </section>`;
  }

  return `${kopf}
    ${vorlaeufig}
    ${kunde}
    ${schnell}
    ${notizAuftrag}
    ${auftrag}${kontakt}${verlauf}
    ${geld}`;
}

// Inhalt neu zeichnen; die Karte selbst bleibt offen
function terminkarteZeichnen(optionen = {}) {
  const a = daten.auftraege.find((x) => x.id === terminkarteId);
  if (!a) return null;
  $("[data-tk-inhalt]", terminkarte).innerHTML = terminkarteInhalt(a, optionen);
  return a;
}

// Das Betragsfeld nur am Computer gleich fokussieren; am Handy bleibt die Tastatur zu
function betragFokus() {
  const feld = $("[data-tk-betrag]", terminkarte);
  if (!feld || istHandy()) return;
  feld.focus({ preventScroll: true });
  feld.select();
}

function oeffneTerminkarte(id) {
  terminkarteId = id;
  if (!terminkarteZeichnen()) return;
  if (!terminkarte.open) terminkarte.showModal();
  betragFokus();
}

terminkarte.addEventListener("click", (e) => {
  const ziel = e.target;
  // Schließen, Kundenseite oder Bearbeiten: die Karte geht zu, der Rest läuft über die Bedienung weiter
  if (ziel.closest("[data-tk-bearbeiten]")) zurueckZurKarte = terminkarteId;
  if (ziel === terminkarte || ziel.closest("[data-tk-zu], [data-tk-kunde], [data-tk-bearbeiten]")) {
    terminkarte.close();
    return;
  }
  if (ziel.closest("[data-tk-aendern]")) {
    terminkarteZeichnen({ bearbeiten: true });
    betragFokus();
    return;
  }
  if (ziel.closest("[data-tk-abbrechen]")) terminkarteZeichnen();
});

terminkarte.addEventListener("input", (e) => {
  if (!e.target.matches("[data-tk-betrag]")) return;
  const a = daten.auftraege.find((x) => x.id === terminkarteId);
  $("[data-tk-tg]", terminkarte).innerHTML = tgTextFuer(betragLesen(e.target.value), zahl(a?.geschaetzt));
  $("[data-tk-fehler]", terminkarte).textContent = "";
});

terminkarte.addEventListener("submit", async (e) => {
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
  const knopf = form.querySelector("[type=submit]");
  knopf.disabled = true;
  try {
    const warSchonBezahlt = zahl(a.bekommen) !== null;
    await aendern("auftraege", a.id, { bekommen: betrag });
    // Verlauf und Stammkunden-Status nur beim ersten Eintrag, bei einer Korrektur nicht noch einmal
    if (!warSchonBezahlt) await nachBezahlung(a.kunde_id, { ...a, bekommen: betrag });
    terminkarteZeichnen({ erfolg: true });
    $("[data-tk-aendern]", terminkarte)?.focus();
    render();
  } catch {
    // Der Fehler steht schon im Toast (speichern)
    knopf.disabled = false;
  }
});

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

// Öffnet das Mailprogramm; ohne Adresse ein Hinweis, wie man den Kunden sonst erreicht
function mailOeffnen(k, art, a, erledigt) {
  if (!k?.email) {
    const weg = k?.nebenan_link || a.kanal === "nebenan" ? "schreib auf nebenan.de" : k?.telefon ? "ruf kurz an" : "meld dich beim Kunden";
    zeigeToast(`${erledigt}. Keine E-Mail hinterlegt – ${weg}`, 5000);
    return;
  }
  const { betreff, text } = kundenMail(k, art, a);
  zeigeToast(erledigt);
  location.href = `mailto:${k.email}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(text)}`;
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
    case "ausgleich": {
      const t = aufteilung();
      if (t.D >= 0.005) dialogAuszahlung({ an: t.hinten.name, betrag: t.D, notiz: "Ausgleich 50/50" });
      return;
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
    await aendern("auftraege", a.id, { bekommen });
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
  db.abonnieren(async (t) => {
    await laden(t);
    renderSpaeter();
  });
  render();
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
