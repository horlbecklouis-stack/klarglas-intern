"use strict";

/* ===================== Handy-Schicht (iPhone + Pixel) =====================
   Wird VOR app.js geladen. Hier stehen oben nur Funktionen: die Grundlagen aus app.js
   ($, daten, render …) gibt es erst, wenn die Funktionen aufgerufen werden.
   Am Computer bleibt alles wie bisher. Nur der eigene Kalender (kalWoche) wird auch dort genutzt. */

const H = {
  geldChart: "umsatz",
  balken: null, // angetippter Balken im Geld-Diagramm
  kalTag: null, // gewählter Tag im Kalender
  belegt: {}, // Woche (ISO vom Montag) → { status, liste }
  hash: null,
  tiefe: 0,
  stapel: [], // wohin „Zurück“ führt
  ohneAnimation: false,
  erledigtOffen: false,
};

const H_TABS = ["uebersicht", "kunden", "kalender", "geld", "aufgaben"];
const H_FEDER = "linear(0, 0.009, 0.035 2.1%, 0.141 4.4%, 0.723 12.9%, 0.938 16.7%, 1.017 19.4%, 1.067, 1.099 24.3%, 1.108 26%, 1.104, 1.088 30.6%, 1.019 39.9%, 0.998 44.4%, 0.991 47.2%, 0.992 53.7%, 1.001 66.6%, 1)";
const H_FEDER_SANFT = "cubic-bezier(0.32, 0.72, 0, 1)";

const hVibe = (ms = 8) => {
  if (!istIos && navigator.vibrate) navigator.vibrate(ms);
};

const hChev = `<svg class="h-chev" viewBox="0 0 8 14" aria-hidden="true"><path d="M1.5 1.5 6.5 7l-5 5.5"/></svg>`;
const hIcon = (pfad, klasse = "") => `<svg class="h-icon ${klasse}" viewBox="0 0 24 24" aria-hidden="true">${pfad}</svg>`;

/* ---------- Bausteine ---------- */

// Großer Titel; klappt beim Scrollen in die Leiste oben ein
function hKopf({ titel, ueber = "", unter = "", zurueck = null, zurueckText = "Zurück", rechts = "", nurLeiste = false, klasse = "" }) {
  return `<header class="h-kopf ${klasse}${nurLeiste ? " h-kopf--leiste" : ""}" data-h-kopf data-titel="${esc(titel)}"${zurueck ? ` data-zurueck="${esc(zurueck)}" data-zurueck-text="${esc(zurueckText)}"` : ""}>
    ${rechts ? `<template data-h-rechts>${rechts}</template>` : ""}
    ${nurLeiste ? "" : `${ueber ? `<p class="h-ueber">${ueber}</p>` : ""}<h1 class="h-titel">${esc(titel)}</h1>${unter ? `<p class="h-unter">${unter}</p>` : ""}`}
  </header>`;
}

// Abschnitt mit Überschrift und weißer Gruppe; ohne Inhalt gar nichts
function hAbschnitt(titel, zeilen, { rechts = "", fuss = "", klasse = "", farbe = "", icon = "" } = {}) {
  if (!zeilen) return "";
  const ico = icon ? `<span class="h-ico" style="--c:${farbe}" aria-hidden="true"><svg viewBox="0 0 24 24">${icon}</svg></span>` : "";
  return `<section class="h-abschnitt ${klasse}${farbe ? " h-abschnitt--glas" : ""}"${farbe ? ` style="--tint:${farbe}"` : ""}>
    ${titel ? `<div class="h-abschnitt__kopf"><h2>${ico}${titel}</h2>${rechts}</div>` : ""}
    <div class="h-gruppe">${zeilen}</div>
    ${fuss ? `<p class="h-fuss">${fuss}</p>` : ""}
  </section>`;
}

// Eine Zeile: das Ziel (Link oder Knopf) deckt die ganze Zeile ab, extra-Knöpfe liegen darüber
function hZeile({ href = null, ziel = "", links = "", titel, unter = "", rechts = "", extra = "", chevron = true, inset = null, klasse = "", style = "" }) {
  const tag = href ? "a" : ziel ? "button" : "div";
  const attr = href ? `href="${esc(href)}"` : ziel ? `type="button" ${ziel}` : "";
  const stil = [inset ? `--inset:${inset}px` : "", style].filter(Boolean).join(";");
  return `<div class="h-zeile ${klasse}"${stil ? ` style="${stil}"` : ""}>
    ${links}
    <${tag} class="h-zeile__text${tag !== "div" ? " h-ziel" : ""}" ${attr}>
      <span class="h-zeile__titel">${titel}</span>
      ${unter ? `<span class="h-zeile__unter">${unter}</span>` : ""}
    </${tag}>
    ${rechts ? `<span class="h-zeile__rechts">${rechts}</span>` : ""}
    ${extra}
    ${chevron && tag !== "div" ? hChev : ""}
  </div>`;
}

// Zeile, die man nach links wischen kann (Aktionen liegen dahinter)
const hWisch = (vorne, aktionen) =>
  aktionen ? `<div class="h-wisch" data-h-wisch><div class="h-wisch__aktionen">${aktionen}</div><div class="h-wisch__vorne">${vorne}</div></div>` : vorne;

const hWischKnopf = (farbe, titel, icon, { href = null, attr = "" } = {}) =>
  href
    ? `<a class="h-wisch__knopf h-wisch__knopf--${farbe}" href="${esc(href)}">${hIcon(icon)}<span>${titel}</span></a>`
    : `<button class="h-wisch__knopf h-wisch__knopf--${farbe}" type="button" ${attr}>${hIcon(icon)}<span>${titel}</span></button>`;

// Kalender-Datum links in einer Zeile: Wochentag klein, Tag groß
function hDatum(iso) {
  const d = new Date(iso);
  const heute = d.toDateString() === new Date().toDateString();
  return `<span class="h-datum${heute ? " h-datum--heute" : ""}" aria-hidden="true"><small>${esc(fmtWochentag.format(d).slice(0, 2))}</small><b>${d.getDate()}</b></span>`;
}

const H_STATUS_KURZ = { neu: "Neu", kontakt: "Kontakt", geplant: "Geplant", termin: "Termin", erledigt: "Erledigt", stamm: "Stamm", abgesagt: "Abgesagt" };
const hStatusFarbe = (id) => STATUS.find((x) => x.id === id)?.farbe || "#8e8e93";
const hAvatarFarbe = (k, klasse = "") => `<span class="h-ava h-ava--farbe ${klasse}" style="--c:${hStatusFarbe(k.status)}" aria-hidden="true">${esc(tkInitialen(k.name) || "?")}</span>`;
const hAvatar = (name, klasse = "") => `<span class="h-ava ${klasse}" aria-hidden="true">${esc(tkInitialen(name) || "?")}</span>`;

// Status als farbiger Text statt Punkt
function hStatus(id) {
  const s = STATUS.find((x) => x.id === id);
  return s ? `<span class="h-status" style="--farbe:${s.farbe}">${esc(s.name)}</span>` : "";
}

const hUhr = (d) => `${fmtUhr.format(d)}`;
const hTagText = (d) => {
  const heute = new Date();
  const t = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(heute.getFullYear(), heute.getMonth(), heute.getDate())) / 86400000);
  if (t === 0) return "Heute";
  if (t === 1) return "Morgen";
  if (t === -1) return "Gestern";
  return fmtTag.format(d);
};

const hTel = (k) => (k?.telefon || "").replace(/[^\d+]/g, "");
const hKarteUrl = (adresse) => `${istIos ? "https://maps.apple.com/?q=" : "https://www.google.com/maps/search/?api=1&query="}${encodeURIComponent(`${adresse}, Berlin`)}`;

const H_ICON = {
  tel: '<path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5L17 13l4 1.5v3a2.5 2.5 0 0 1-2.7 2.5C10.9 19.5 4.5 13.1 4 5.7A2.5 2.5 0 0 1 6.5 3Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 8 8 5 8-5"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  muell: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  suche: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  geld: '<rect x="2.5" y="6" width="19" height="12.5" rx="3"/><circle cx="12" cy="12.25" r="2.75"/>',
  person: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c.7-4 3.7-6.5 7.5-6.5s6.8 2.5 7.5 6.5"/>',
  termin: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  auftrag: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M12 4v16M4 12h16"/>',
  uhr: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  haken: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  post: '<path d="M3.5 13.5 6 5.5h12l2.5 8M3.5 13.5V19h17v-5.5M3.5 13.5h5l1 2.5h5l1-2.5h5"/>',
  euro: '<path d="M17.5 6.5A6.5 6.5 0 1 0 17.5 17.5M4.5 10.5h9M4.5 13.5h9"/>',
  stern: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  balken: '<path d="M5 20V11M12 20V5M19 20v-6"/>',
  fenster: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M12 3.5v17M4.5 12h15"/>',
  kasse: '<rect x="2.5" y="6" width="19" height="12.5" rx="3"/><circle cx="12" cy="12.25" r="2.75"/>',
  prozent: '<path d="M18 6 6 18"/><circle cx="7.5" cy="7.5" r="2.2"/><circle cx="16.5" cy="16.5" r="2.2"/>',
  minus: '<path d="M12 4v15m0 0-5-5m5 5 5-5"/>',
};

/* ===================== Übersicht ===================== */

function hUebersicht() {
  const jetzt = new Date();
  const monat = zeitraumGrenzen("monat", jetzt);
  const m = zahlenFuer(monat.von, monat.bis);
  const v = zahlenFuer(monat.vorVon, monat.vorBis);
  const tgQuote = trinkgeldQuote(bezahltImZeitraum(monat.von, monat.bis));
  const kz = kennzahlenFuer(monat.von, monat.bis);
  const trend = v.umsatz > 0 ? Math.round(((m.umsatz - v.umsatz) / v.umsatz) * 100) : null;
  const monatName = fmtMonat.format(jetzt).split(" ")[0];

  const mini = (zeige, titel, wert, info, klasse = "") => `<button class="h-mini ${klasse}" type="button" data-h="zu-geld" data-wert="${zeige}">
      <span class="h-mini__titel">${titel}</span>
      <span class="h-mini__wert">${wert}</span>
      <span class="h-mini__info">${info}</span>
    </button>`;
  const trendText = trend === null
    ? `${m.auftraege} ${m.auftraege === 1 ? "Auftrag" : "Aufträge"}`
    : `<span class="${trend >= 0 ? "h-plus" : "h-minus"}">${trend >= 0 ? "↑" : "↓"} ${Math.abs(trend)} %</span> zum Vormonat`;

  const zahlen = `<div class="h-minis">
    ${mini("umsatz", `Umsatz ${esc(monatName)}`, euro(m.umsatz), trendText, "h-mini--farbe h-mini--blau")}
    ${mini("kasse", "Kasse", euro(kassenstand()), "Bargeld da", "h-mini--farbe h-mini--schwarz")}
    ${mini("trinkgeld", "Trinkgeld", tgQuote === null ? "–" : `${tgQuote} %`, `${euro(m.trinkgeld)} extra`, "h-mini--farbe h-mini--gruen")}
    ${mini("kz", "Ø pro Stunde", euroOder(kz.proStunde), kz.auftraege ? stundenText(kz.stunden * 60) : "noch keine Aufträge", "h-mini--farbe h-mini--gelb")}
  </div>`;

  const anfragen = anfragenTermine();
  const kassieren = nochEintragen();
  const geplant = geplanteTermine();
  const termine = kommendeTermine().slice(0, 5);
  const aufgaben = daten.aufgaben.filter((a) => !a.erledigt).sort(nachFaelligkeit).slice(0, 5);

  const anfragenHtml = anfragen.map((a) => {
    const k = kundeVon(a.kunde_id);
    const d = new Date(a.datum);
    return `<div class="h-anfrage">
      ${hZeile({
        ziel: `data-aktion="termin-karte" data-id="${esc(a.id)}"`,
        links: hDatum(a.datum),
        titel: `${kanalMarke(a.kanal)}${esc(k?.name || "Unbekannt")}`,
        unter: `${esc(hTagText(d))}, ${esc(hUhr(d))} Uhr · ${esc(a.leistung || "")}${zahl(a.geschaetzt) !== null ? ` · ca. ${euro(a.geschaetzt)}` : ""}`,
        inset: 64,
      })}
      <div class="h-anfrage__knoepfe">
        <button class="h-pill h-pill--voll" type="button" data-aktion="termin-bestaetigen" data-id="${esc(a.id)}">Bestätigen</button>
        <button class="h-pill" type="button" data-aktion="termin-verschieben" data-id="${esc(a.id)}">Anderer Termin</button>
        <button class="h-pill h-pill--rot" type="button" data-aktion="termin-ablehnen" data-id="${esc(a.id)}">Ablehnen</button>
      </div>
    </div>`;
  }).join("");

  const kassierenHtml = kassieren.map((a) => {
    const k = kundeVon(a.kunde_id);
    return hZeile({
      ziel: `data-aktion="termin-karte" data-id="${esc(a.id)}"`,
      links: hDatum(a.datum),
      titel: esc(k?.name || "Unbekannt"),
      unter: `${esc(hTagText(new Date(a.datum)))} · ${esc(a.leistung || "")}`,
      rechts: zahl(a.geschaetzt) !== null ? `<span class="h-leise">~${euro(a.geschaetzt)}</span>` : "",
      extra: `<span class="h-pill h-pill--klein h-pill--bernstein" aria-hidden="true">Kassieren</span>`,
      chevron: false,
      inset: 64,
    });
  }).join("");

  const geplantHtml = geplant.map((a) => {
    const d = a.datum ? new Date(a.datum) : null;
    return hZeile({
      ziel: `data-aktion="termin-karte" data-id="${esc(a.id)}"`,
      links: d ? hDatum(a.datum) : `<span class="h-datum h-datum--leer" aria-hidden="true">?</span>`,
      titel: `${esc(auftragName(a))}${istTermin(a) ? ` <span class="h-art">${esc(auftragTitel(a))}</span>` : ""}`,
      unter: d ? `wahrscheinlich ${esc(hTagText(d))}, ${esc(hUhr(d))} Uhr${d < new Date() ? ' · <span class="h-minus">vorbei</span>' : ""}` : "noch ohne Tag",
      extra: `<button class="h-pill h-pill--klein h-pill--voll" type="button" data-aktion="termin-fix" data-id="${esc(a.id)}">Fix machen</button>`,
      chevron: false,
      inset: 64,
    });
  }).join("");

  const termineHtml = termine.map(hTerminZeile).join("");
  const aufgabenHtml = aufgaben.map((a) => hAufgabeZeile(a)).join("");

  const nichts = !anfragen.length && !kassieren.length && !geplant.length && !termine.length && !aufgaben.length;

  return `
    ${hKopf({ titel: `Hallo ${ich}`, ueber: esc(fmtTagLang.format(jetzt)) })}
    ${zahlen}
    ${hAbschnitt(anfragen.length ? `Neue Anfragen <span class="h-zahl">${anfragen.length}</span>` : "", anfragenHtml, { klasse: "h-abschnitt--anfragen", farbe: "#5B3FD6", icon: H_ICON.post })}
    ${hAbschnitt(kassieren.length ? "Noch kassieren" : "", kassierenHtml, { farbe: "#F2B33D", icon: H_ICON.euro, fuss: kassieren.length ? "Antippen und eintragen, was ihr wirklich bekommen habt." : "" })}
    ${hAbschnitt(geplant.length ? "Geplant, noch nicht fest" : "", geplantHtml, { farbe: "#E67C73", icon: H_ICON.uhr })}
    ${hAbschnitt(termine.length ? "Nächste Termine" : "", termineHtml, { farbe: "#2B5CFF", icon: H_ICON.termin, rechts: `<a class="h-link" href="#kalender">Kalender</a>` })}
    ${hAbschnitt(aufgaben.length ? "Offene Aufgaben" : "", aufgabenHtml, { farbe: "#13A06B", icon: H_ICON.haken, rechts: `<a class="h-link" href="#aufgaben">Alle</a>` })}
    ${nichts ? `<p class="h-leer">Alles ruhig. Zeit für Werbung im Märchenviertel.</p>` : ""}`;
}

function hTerminZeile(a) {
  const k = kundeVon(a.kunde_id);
  const d = new Date(a.datum);
  return hZeile({
    ziel: `data-aktion="termin-karte" data-id="${esc(a.id)}"`,
    links: hDatum(a.datum),
    titel: `${kanalMarke(a.kanal)}${esc(auftragName(a))}${istTermin(a) ? ` <span class="h-art">${esc(auftragTitel(a))}</span>` : ""}`,
    unter: `${esc(hTagText(d))}, ${esc(hUhr(d))} Uhr${istTermin(a) ? "" : ` · ${esc(a.leistung || "")}`}${k?.adresse ? ` · ${esc(k.adresse)}` : ""}`,
    rechts: !istTermin(a) && zahl(a.geschaetzt) !== null ? `<span class="h-leise">~${euro(a.geschaetzt)}</span>` : "",
    inset: 64,
  });
}

/* ===================== Aufgaben (wie Erinnerungen) ===================== */

function hAufgabeZeile(a, { wischen = false } = {}) {
  const k = a.kunde_id ? kundeVon(a.kunde_id) : null;
  const ueberfaellig = a.faellig && !a.erledigt && a.faellig < heuteIso();
  const unter = [
    a.faellig ? `<span class="${ueberfaellig ? "h-minus" : ""}">${esc(hTagText(new Date(`${a.faellig}T12:00`)))}</span>` : "",
    k ? esc(k.name) : "",
  ].filter(Boolean).join(" · ");
  const art = { Louis: "louis", Lukas: "lukas" }[a.zustaendig] || "beide";
  const vorne = `<div class="h-aufgabe${a.erledigt ? " ist-erledigt" : ""}">
    <button class="h-haken h-haken--${art}" type="button" role="checkbox" aria-checked="${Boolean(a.erledigt)}" aria-label="${esc(a.titel)} erledigt" data-h="haken" data-id="${esc(a.id)}"><span></span></button>
    <button class="h-aufgabe__text" type="button" data-aktion="aufgabe-bearbeiten" data-id="${esc(a.id)}">
      <span class="h-aufgabe__titel">${esc(a.titel)}</span>
      ${unter ? `<span class="h-zeile__unter">${unter}</span>` : ""}
    </button>
    <span class="h-person h-person--${art}">${esc(a.zustaendig || "Beide")}</span>
  </div>`;
  return wischen ? hWisch(vorne, hWischKnopf("rot", "Löschen", H_ICON.muell, { attr: `data-h="aufgabe-loeschen" data-id="${esc(a.id)}"` })) : vorne;
}

function hAufgaben() {
  const f = PERSONEN.includes(zustand.aufgabenFilter) ? zustand.aufgabenFilter : "offen";
  const fuer = (a) => f === "offen" || a.zustaendig === f || a.zustaendig === "Beide";
  const offen = daten.aufgaben.filter((a) => !a.erledigt && fuer(a)).sort(nachFaelligkeit);
  const erledigt = daten.aufgaben.filter((a) => a.erledigt && fuer(a)).sort((a, b) => new Date(b.erstellt) - new Date(a.erstellt));
  const alleOffen = daten.aufgaben.filter((a) => !a.erledigt);
  const zaehl = (w) => alleOffen.filter((a) => w === "offen" || a.zustaendig === w || a.zustaendig === "Beide").length;
  const ueberfaellig = offen.filter((a) => a.faellig && a.faellig < heuteIso()).length;
  const filter = [["offen", "Alle", "∗", "#151a2e"], ["Louis", "Louis", "Lo", "#2B5CFF"], ["Lukas", "Lukas", "Lu", "#13A06B"]];
  return `
    ${hKopf({ titel: "Aufgaben", unter: `${offen.length} offen${ueberfaellig ? ` · <span class="h-minus">${ueberfaellig} überfällig</span>` : ""}` })}
    <div class="h-wer" role="group" aria-label="Aufgaben filtern">
      ${filter.map(([wert, name, kurz, farbe]) => `<button class="h-wer__kachel" type="button" style="--c:${farbe}" aria-pressed="${f === wert}" data-aktion="aufgaben-filter" data-wert="${wert}"><em aria-hidden="true">${kurz}</em><span>${name}</span><b>${zaehl(wert)}</b></button>`).join("")}
    </div>
    <section class="h-abschnitt">
      <div class="h-gruppe h-gruppe--aufgaben">
        ${offen.map((a) => hAufgabeZeile(a, { wischen: true })).join("")}
        <button class="h-neu" type="button" data-aktion="aufgabe-neu">${hIcon(H_ICON.plus)}Neue Aufgabe</button>
      </div>
      ${!offen.length ? `<p class="h-fuss">Nichts offen. Stark.</p>` : ""}
    </section>
    ${erledigt.length ? `<details class="h-erledigt" data-h-erledigt${H.erledigtOffen ? " open" : ""}>
      <summary>Erledigt <span class="h-leise">${erledigt.length}</span></summary>
      <div class="h-gruppe h-gruppe--aufgaben">${erledigt.slice(0, 30).map((a) => hAufgabeZeile(a, { wischen: true })).join("")}</div>
    </details>` : ""}
    ${istIos ? `<p class="h-fuss">Deine Aufgaben (nur „Louis“) holt sich OutPost automatisch in die Erinnerungen-Liste „Klar Glas“.</p>` : ""}`;
}

/* ===================== Kunden ===================== */

function hKunden() {
  const q = zustand.suche.trim().toLowerCase();
  const passt = (k) => !q || [k.name, k.adresse, k.telefon, k.email].some((x) => (x || "").toLowerCase().includes(q));
  const gesucht = daten.kunden.filter(passt);
  const liste = gesucht
    .filter((k) => zustand.kundenFilter === "alle" || k.status === zustand.kundenFilter)
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  // Nach Anfangsbuchstabe gruppiert, wie in Kontakte
  const gruppen = [];
  liste.forEach((k) => {
    const b = (k.name || "#").charAt(0).toUpperCase().replace(/[^A-ZÄÖÜ]/, "#");
    const letzte = gruppen[gruppen.length - 1];
    if (letzte && letzte.b === b) letzte.kunden.push(k);
    else gruppen.push({ b, kunden: [k] });
  });

  const zeile = (k) => {
    const tel = hTel(k);
    const t = naechsterTermin(k.id);
    const vorne = hZeile({
      href: `#kunde/${k.id}`,
      links: hAvatarFarbe(k),
      titel: esc(k.name),
      unter: t ? `Termin ${esc(hTagText(new Date(t.datum)))}` : esc(k.adresse || k.telefon || ""),
      rechts: hStatus(k.status),
      inset: 62,
    });
    const aktionen = [
      tel ? hWischKnopf("gruen", "Anrufen", H_ICON.tel, { href: `tel:${tel}` }) : "",
      k.email ? hWischKnopf("blau", "Mail", H_ICON.mail, { href: `mailto:${k.email}` }) : "",
    ].join("");
    return hWisch(vorne, aktionen);
  };

  const kachel = (wert, name, n, farbe) => `<button class="h-filter__kachel" type="button" style="--c:${farbe}" aria-pressed="${zustand.kundenFilter === wert}" data-aktion="filter" data-wert="${wert}"><span>${esc(name)}</span><b>${n}</b></button>`;
  const anzahl = (id) => gesucht.filter((k) => k.status === id).length;
  const pipe = STATUS.filter((x) => x.id !== "abgesagt" && anzahl(x.id))
    .map((x) => `<i style="--c:${x.farbe};--n:${anzahl(x.id)}" title="${esc(x.name)}: ${anzahl(x.id)}"></i>`).join("");

  return `
    ${hKopf({ titel: "Kunden", unter: `${daten.kunden.length} insgesamt` })}
    <label class="h-suche">
      ${hIcon(H_ICON.suche)}
      <span class="visually-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">Kunden suchen</span>
      <input id="suche" type="search" placeholder="Suchen" value="${esc(zustand.suche)}" data-suche autocomplete="off" enterkeyhint="search" />
    </label>
    ${pipe ? `<div class="h-pipe" aria-hidden="true">${pipe}</div>` : ""}
    <div class="h-filter" role="group" aria-label="Nach Status filtern">
      ${kachel("alle", "Alle", gesucht.length, "#2B5CFF")}
      ${STATUS.map((x) => kachel(x.id, H_STATUS_KURZ[x.id] || x.name, anzahl(x.id), x.farbe)).join("")}
    </div>
    ${gruppen.length
      ? gruppen.map((g) => `<section class="h-abschnitt h-abschnitt--buchstabe"><h2 class="h-buchstabe">${esc(g.b)}</h2><div class="h-gruppe">${g.kunden.map(zeile).join("")}</div></section>`).join("")
      : `<p class="h-leer">${daten.kunden.length ? "Niemand gefunden." : "Noch keine Kunden. Anfragen von der Website landen automatisch hier."}</p>`}
    ${liste.length > 3 ? `<p class="h-fuss h-fuss--mitte">Nach links wischen zum Anrufen oder Schreiben</p>` : ""}`;
}

function hKunde(id) {
  const k = kundeVon(id);
  if (!k) return `${hKopf({ titel: "Kunde", zurueck: "#kunden", zurueckText: "Kunden" })}<p class="h-leer">Diesen Kunden gibt es nicht (mehr).</p>`;
  const auftraege = auftraegeVon(id).sort((a, b) => auftragDatum(b) - auftragDatum(a));
  const bezahlt = auftraege.filter((a) => zahl(a.bekommen) !== null);
  const umsatz = bezahlt.reduce((s, a) => s + Number(a.bekommen), 0);
  const tg = bezahlt.reduce((s, a) => s + trinkgeld(a), 0);
  const quote = trinkgeldQuote(bezahlt);
  const letzter = bezahlt.map(auftragDatum).sort((a, b) => b - a)[0];
  const naechster = naechsterTermin(id);
  const fenster = auftraege.find((a) => a.fenster_normal || a.fenster_boden);
  const notizen = daten.notizen.filter((n) => n.kunde_id === id).sort((a, b) => new Date(b.erstellt) - new Date(a.erstellt));
  const tel = hTel(k);
  const kam = kanalVonKunde(k);

  const schnell = `<div class="tk-schnell h-schnell">
    ${tkSchnell(!!tel, `tel:${tel}`, "gruen", ICONS.kontakt, "Anrufen")}
    ${tkSchnell(!!k.email, `mailto:${k.email || ""}`, "blau", ICONS.mail, "Mail")}
    ${tkSchnell(!!k.adresse, k.adresse ? hKarteUrl(k.adresse) : "", "bernstein", TK_ICON.pin, "Route", ' target="_blank" rel="noopener"')}
    ${tkSchnell(!!k.nebenan_link, k.nebenan_link ? nebenanUrl(k.nebenan_link) : "", "nebenan", ICONS.haus, "nebenan", ' target="_blank" rel="noopener"')}
  </div>`;

  const wert = (titel, inhaltHtml, href = null) => hZeile({ href, titel: `<span class="h-zeile__klein">${titel}</span>${inhaltHtml}`, chevron: false, klasse: "h-zeile--wert" });
  const kontakt = [
    k.telefon ? wert("Telefon", `<span class="h-akzent">${esc(k.telefon)}</span>`, `tel:${tel}`) : "",
    k.email ? wert("E-Mail", `<span class="h-akzent">${esc(k.email)}</span>`, `mailto:${k.email}`) : "",
    k.adresse ? wert("Adresse", `<span class="h-akzent">${esc(k.adresse)}</span>`, hKarteUrl(k.adresse)) : "",
    kam ? wert("Kam über", esc(kanalName(kam))) : "",
  ].join("");

  const stats = `<div class="h-stats">
    <div style="--c:#2B5CFF"><b>${bezahlt.length}</b><small>${bezahlt.length === 1 ? "Besuch" : "Besuche"}</small></div>
    <div style="--c:#13A06B"><b>${euro(umsatz)}</b><small>Umsatz</small></div>
    <div style="--c:#F2B33D"><b>${quote !== null ? `${quote} %` : "–"}</b><small>${tg ? `${euro(tg)} Trinkgeld` : "Ø Trinkgeld"}</small></div>
  </div>`;

  const blick = [
    ["Letzter Besuch", letzter ? esc(fmtDatum.format(letzter)) : "–"],
    ["Nächster Termin", naechster ? esc(fmtTag.format(new Date(naechster.datum))) : "–"],
    ["Fenster", fenster ? `${Number(fenster.fenster_normal || 0)} + ${Number(fenster.fenster_boden || 0)} bodentief` : "–"],
  ].map(([t, w]) => `<div class="h-zeile h-zeile--paar"><span class="h-zeile__text"><span class="h-zeile__titel">${t}</span></span><span class="h-zeile__rechts">${w}</span></div>`).join("");

  const auftragZeilen = auftraege.map((a) => {
    const d = a.datum ? new Date(a.datum) : null;
    const rechts = istTermin(a) ? "" : zahl(a.bekommen) !== null ? `<b>${euro(a.bekommen)}</b>` : `<span class="h-leise">offen</span>`;
    const marke = a.abgesagt ? " · abgesagt" : a.vorlaeufig ? " · vorläufig" : a.termin_status === "angefragt" ? " · angefragt" : "";
    const farbe = a.abgesagt ? "#B5B9C3" : zahl(a.bekommen) !== null ? "#13A06B" : a.vorlaeufig || a.termin_status === "angefragt" ? "#E67C73" : istTermin(a) ? "#5B3FD6" : "#2B5CFF";
    return hZeile({
      klasse: "h-zeile--zeit",
      style: `--c:${farbe}`,
      ziel: `data-aktion="termin-karte" data-id="${esc(a.id)}"`,
      links: d ? hDatum(a.datum) : `<span class="h-datum h-datum--leer" aria-hidden="true">?</span>`,
      titel: `${esc(auftragTitel(a))}<span class="h-leise">${marke}</span>`,
      unter: d ? `${esc(fmtDatum.format(d))}, ${esc(hUhr(d))} Uhr${zahl(a.geschaetzt) !== null ? ` · geschätzt ${euro(a.geschaetzt)}` : ""}` : "ohne Termin",
      rechts,
      inset: 64,
    });
  }).join("");

  return `
    <section class="h-held" style="--c:${hStatusFarbe(k.status)}">
    ${hKopf({
      titel: k.name,
      zurueck: "#kunden",
      zurueckText: "Kunden",
      klasse: "h-kopf--kontakt",
      rechts: `<button class="h-leiste__text" type="button" data-aktion="kunde-bearbeiten" data-id="${esc(k.id)}">Bearbeiten</button>`,
      ueber: hAvatarFarbe(k, "h-ava--gross"),
      unter: `<span class="h-leise">${k.adresse ? `${esc(k.adresse)} · ` : ""}seit ${esc(fmtDatum.format(new Date(k.erstellt)))}</span>`,
    })}
      <label class="h-status-wahl" style="--farbe:${hStatusFarbe(k.status)}">
        <span class="visually-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">Status</span>
        <select data-status-wahl="${esc(k.id)}">${STATUS.map((x) => `<option value="${x.id}"${x.id === k.status ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
      </label>
      ${schnell}
    </section>
    ${stats}

    <section class="h-abschnitt">
      <div class="h-abschnitt__kopf"><h2>Wie geht's weiter?</h2></div>
      <div class="h-gruppe"><textarea class="h-textfeld" rows="2" data-weiter="${esc(k.id)}" placeholder="Nur der nächste Schritt, z. B. Samstag zurückrufen">${esc(k.weiter || "")}</textarea></div>
    </section>

    ${hAbschnitt("Kontakt", kontakt)}

    ${hAbschnitt("Auf einen Blick", blick)}

    <section class="h-abschnitt">
      <div class="h-abschnitt__kopf"><h2>Aufträge und Termine</h2></div>
      ${auftragZeilen ? `<div class="h-gruppe h-gruppe--zeit">${auftragZeilen}</div>` : ""}
      <div class="h-doppel">
        <button class="h-pill h-pill--voll" type="button" data-aktion="auftrag-neu" data-kunde="${esc(k.id)}">${hIcon(H_ICON.plus)}Auftrag</button>
        <button class="h-pill" type="button" data-aktion="termin-neu" data-kunde="${esc(k.id)}">${hIcon(H_ICON.plus)}Termin</button>
      </div>
    </section>

    <section class="h-abschnitt">
      <div class="h-abschnitt__kopf"><h2>Verlauf</h2></div>
      <div class="h-gruppe h-gruppe--innen">
        <form class="formular h-notiz" data-notiz-form="${esc(k.id)}">
          <div class="h-chips h-chips--wahl">${Object.entries(NACHRICHT_QUELLEN).map(([qid, name]) => `<label class="h-chip"><input type="radio" name="quelle" value="${qid}"${qid === "notiz" ? " checked" : ""} />${esc(name)}</label>`).join("")}</div>
          <textarea class="h-textfeld" name="text" rows="2" required placeholder="Notiz oder Nachricht vom Kunden reinkopieren"></textarea>
          <button class="h-pill h-pill--voll" type="submit">Speichern</button>
        </form>
        ${notizen.length ? `<ul class="verlauf h-verlauf">${notizen.map(verlaufEintrag).join("")}</ul>` : ""}
      </div>
    </section>`;
}

/* ===================== Geld ===================== */

const H_CHARTS = [
  ["umsatz", "Umsatz"],
  ["gewinn", "Gewinn"],
  ["trinkgeld", "Trinkgeld"],
  ["kasse", "Kasse"],
];
const H_CHART_FARBE = { umsatz: "#2B5CFF", gewinn: "#6A4BE0", trinkgeld: "#13A06B", kasse: "#151a2e" };

// Bewegung als kleine Kachel (Geld-Seite)
function hBewegungKachel(b) {
  const ART = { rein: ["#13A06B", H_ICON.minus], aus: ["#E5372F", '<path d="M12 20V5m0 0-5 5m5-5 5 5"/>'], auszahlung: ["#2B5CFF", '<path d="M4 12h15m0 0-5-5m5 5-5 5"/>'], lohn: ["#6A4BE0", H_ICON.person] };
  const [farbe, pfad] = ART[b.art];
  const tag = b.link ? "a" : "button";
  const attr = b.link ? `href="${esc(b.link)}"` : `type="button" data-aktion="${b.aktion}" data-id="${esc(b.id)}"`;
  return `<${tag} class="h-bew" style="--c:${farbe}" ${attr}>
    <span class="h-bew__ico" aria-hidden="true"><svg viewBox="0 0 24 24">${pfad}</svg></span>
    <b class="${b.betrag >= 0 ? "h-plus" : ""}">${b.betrag >= 0 ? "+" : ""}${euro(b.betrag)}</b>
    <span class="h-bew__titel">${esc(b.titel)}</span>
    <small>${esc(hTagText(b.datum))}</small>
  </${tag}>`;
}

// Kassenstand am Ende eines Abschnitts (für das Kasse-Diagramm)
function hKasseBis(bis) {
  const grenze = Math.min(bis.getTime(), Date.now() + 1);
  let stand = 0;
  for (const v of kassenstandVerlauf()) {
    if (v.datum.getTime() < grenze) stand = v.stand;
  }
  return stand;
}

function hChartWert(art, von, bis) {
  if (art === "kasse") return von > new Date() ? 0 : hKasseBis(bis);
  return zahlenFuer(von, bis)[art] || 0;
}

// Balkendiagramm zum Antippen
function hBalken(punkte, aktiv) {
  const B = 340, HOEHE = 170, unten = 22, oben = 10;
  const werte = punkte.map((p) => p.wert);
  const max = Math.max(0, ...werte);
  const min = Math.min(0, ...werte);
  const spanne = max - min || 1;
  const y = (w) => oben + ((max - w) / spanne) * (HOEHE - unten - oben);
  const null_y = y(0);
  const schritt = B / punkte.length;
  const breite = Math.min(22, schritt * 0.62);
  let svg = `<svg class="h-diagramm" viewBox="0 0 ${B} ${HOEHE}" role="img" aria-label="${esc(punkte.map((p) => `${p.titel}: ${euro(p.wert)}`).join("; "))}">`;
  svg += `<line x1="0" x2="${B}" y1="${null_y.toFixed(1)}" y2="${null_y.toFixed(1)}" class="h-diagramm__null" />`;
  punkte.forEach((p, i) => {
    const x = i * schritt + (schritt - breite) / 2;
    const oberkante = Math.min(y(p.wert), null_y);
    const h = Math.max(Math.abs(null_y - y(p.wert)), p.wert ? 3 : 0);
    const klasse = i === aktiv ? " ist-aktiv" : aktiv !== null ? " ist-leise" : "";
    svg += `<g class="h-diagramm__balken${klasse}${p.wert < 0 ? " ist-minus" : ""}" data-h="balken" data-i="${i}">
      <rect class="h-diagramm__treffer" x="${(i * schritt).toFixed(1)}" y="0" width="${schritt.toFixed(1)}" height="${HOEHE}" />
      <rect x="${x.toFixed(1)}" y="${oberkante.toFixed(1)}" width="${breite.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(5, breite / 2).toFixed(1)}" />
    </g>`;
    const zeigen = punkte.length <= 7 || i % 2 === 0 || i === punkte.length - 1;
    if (zeigen) svg += `<text x="${(i * schritt + schritt / 2).toFixed(1)}" y="${HOEHE - 5}" text-anchor="middle" class="h-diagramm__text${i === aktiv ? " ist-aktiv" : ""}">${esc(p.label)}</text>`;
  });
  return `${svg}</svg>`;
}

function hGeldBewegungZeile(b) {
  const PFEILE = {
    rein: ["gruen", '<path d="M12 4v15m0 0-5-5m5 5 5-5"/>'],
    aus: ["rot", '<path d="M12 20V5m0 0-5 5m5-5 5 5"/>'],
    auszahlung: ["blau", '<path d="M4 12h15m0 0-5-5m5 5-5 5"/>'],
    lohn: ["violett", '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.6-3.6 3.5-6 7-6s6.4 2.4 7 6"/>'],
  };
  const [farbe, pfad] = PFEILE[b.art];
  return hZeile({
    href: b.link || null,
    ziel: b.link ? "" : `data-aktion="${b.aktion}" data-id="${esc(b.id)}"`,
    links: `<span class="bewegung-icon bewegung-icon--${farbe} h-bewegung-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${pfad}</svg></span>`,
    titel: esc(b.titel),
    unter: `${esc(hTagText(b.datum))}${b.unter ? ` · ${esc(b.unter)}` : ""}`,
    rechts: `<span class="${b.betrag >= 0 ? "h-plus" : ""}">${b.betrag >= 0 ? "+" : ""}${euro(b.betrag)}</span>`,
    chevron: false,
    inset: 60,
  });
}

function hGeld(id) {
  if (id === "bewegungen") {
    const alle = bewegungenListe();
    return `${hKopf({ titel: "Bewegungen", zurueck: "#geld", zurueckText: "Geld", unter: `${alle.length} insgesamt` })}
      ${hAbschnitt("", alle.map(hGeldBewegungZeile).join("")) || `<p class="h-leer">Noch nichts eingetragen.</p>`}`;
  }
  const z = zustand;
  const zr = z.geldZeitraum;
  const g = zeitraumGrenzen(zr, z.geldStichtag);
  const m = zahlenFuer(g.von, g.bis);
  const v = zahlenFuer(g.vorVon, g.vorBis);
  const art = H.geldChart;
  const { untertitel, punkte } = zeitreihe(zr, z.geldStichtag);
  const reihe = punkte.map((p) => ({ ...p, wert: Math.round(hChartWert(art, p.von, p.bis) * 100) / 100 }));
  const aktiv = H.balken !== null && H.balken < reihe.length ? H.balken : null;
  const kasse = kassenstand();
  const gesamt = { umsatz: m.umsatz, gewinn: m.gewinn, trinkgeld: m.trinkgeld, kasse };
  const vorher = { umsatz: v.umsatz, gewinn: v.gewinn, trinkgeld: v.trinkgeld };
  const name = Object.fromEntries(H_CHARTS)[art];

  let gross, klein;
  if (aktiv !== null) {
    gross = euro(reihe[aktiv].wert);
    klein = `${esc(name)} · ${esc(reihe[aktiv].titel)}`;
  } else if (art === "kasse") {
    gross = euro(kasse);
    klein = "Kassenstand jetzt";
  } else {
    gross = euro(gesamt[art]);
    const diff = vorher[art] > 0 ? Math.round(((gesamt[art] - vorher[art]) / vorher[art]) * 100) : null;
    klein = `${esc(name)} · ${esc(g.label)}${diff !== null ? ` · <span class="${diff >= 0 ? "h-plus" : "h-minus"}">${diff >= 0 ? "↑" : "↓"} ${Math.abs(diff)} %</span>` : ""}`;
  }

  const tg = trinkgeldQuote(bezahltImZeitraum(g.von, g.bis));
  const kacheln = H_CHARTS.map(([id2, titel]) => {
    const wert = id2 === "trinkgeld" && tg !== null ? `${euro(m.trinkgeld)}` : euro(gesamt[id2]);
    const info = id2 === "kasse" ? "jetzt" : id2 === "trinkgeld" && tg !== null ? `Ø ${tg} %` : id2 === "gewinn" ? `nach ${euro(m.ausgaben + (m.loehne || 0))} Kosten` : `${m.auftraege} ${m.auftraege === 1 ? "Auftrag" : "Aufträge"}`;
    return `<button class="h-mini h-mini--wahl" type="button" style="--c:${H_CHART_FARBE[id2]}" aria-pressed="${art === id2}" data-h="geld-chart" data-wert="${id2}">
      <span class="h-mini__titel">${titel}</span><span class="h-mini__wert">${wert}</span><span class="h-mini__info">${info}</span>
    </button>`;
  }).join("");

  const erstattungen = offeneErstattungen();
  const t = aufteilung();
  const teil = t.personen.map((p) => {
    const rund = Math.round(p.noch * 100) / 100;
    return `<div class="h-teil h-teil--${p.name === "Louis" ? "louis" : p.name === "Lukas" ? "lukas" : "andere"}"><span class="h-teil__name">${esc(p.name)}</span><b>${euro(Math.abs(rund))}</b><small>${rund === 0 ? "ausgeglichen" : rund > 0 ? "bekommt noch" : "hat zu viel"}</small></div>`;
  }).join("");
  const ausgleich = t.D >= 0.005 && t.D <= kasse + 0.005
    ? `<button class="h-pill h-pill--hell" type="button" data-aktion="ausgleich">Ausgleich auszahlen · ${euro(t.D)} an ${esc(t.hinten.name)}</button>`
    : "";

  const bewegungen = bewegungenListe();
  const k = kennzahlenFuer(g.von, g.bis);
  const kz = (zeige, titel, wert, farbe, icon) => `<button class="h-kz__kachel" type="button" style="--c:${farbe}" data-aktion="geld-tab" data-wert="${zeige}">
      <i aria-hidden="true"><svg viewBox="0 0 24 24">${icon}</svg></i><b>${wert}</b><small>${titel}</small>
    </button>`;

  return `
    ${hKopf({ titel: "Geld" })}
    ${zeitraumWahl(g)}

    <section class="h-chart" aria-label="Diagramm" style="--c:${H_CHART_FARBE[art]}">
      <p class="h-chart__wert">${gross}</p>
      <p class="h-chart__klein">${klein}</p>
      ${hBalken(reihe, aktiv)}
      <p class="h-chart__hinweis">${esc(untertitel)}${aktiv !== null ? ` · <button class="h-link" type="button" data-h="balken-weg">Zurück zur Summe</button>` : " · Balken antippen"}</p>
    </section>
    <div class="h-minis h-minis--geld" role="group" aria-label="Diagramm wählen">${kacheln}</div>

    <section class="h-abschnitt">
      <div class="h-abschnitt__kopf"><h2><span class="h-ico" style="--c:#6A4BE0" aria-hidden="true"><svg viewBox="0 0 24 24">${H_ICON.balken}</svg></span>Kennzahlen</h2><span class="h-leise">${esc(g.label)}</span></div>
      <div class="h-kz">
        ${kz("kz-auftrag", "Ø Auftrag", euroOder(k.proAuftrag), "#2B5CFF", H_ICON.auftrag)}
        ${kz("kz-stunde", "Ø Stunde", euroOder(k.proStunde), "#6A4BE0", H_ICON.uhr)}
        ${kz("kz-fenster", "Ø Fenster", euroOder(k.proFenster), "#13A06B", H_ICON.fenster)}
        ${kz("kz-loehne", "Löhne", euro(k.loehne), "#E67C73", H_ICON.person)}
        ${kz("kz-kasse", "Kasse / Std", euroOder(k.kasseProStunde), "#F2B33D", H_ICON.kasse)}
        ${kz("auftraege", "Aufträge", String(m.auftraege), "#151a2e", H_ICON.haken)}
        ${kz("ausgaben", "Ausgaben", euro(m.ausgaben), "#E5372F", H_ICON.minus)}
        ${kz("marge", "Marge", m.marge === null ? "–" : `${m.marge} %`, "#0FA3B1", H_ICON.prozent)}
        ${kz("kz-stunde", "Stunden", k.auftraege ? stundenText(k.stunden * 60) : "–", "#8a5cf6", H_ICON.uhr)}
      </div>
      ${k.geschaetzt ? `<p class="h-fuss">${k.geschaetzt} von ${k.auftraege} Dauern geschätzt.</p>` : ""}
    </section>

    <section class="h-kasse" aria-labelledby="h-kasse-titel">
      <p class="h-kasse__titel" id="h-kasse-titel">Kassenstand</p>
      <p class="h-kasse__wert">${euro(kasse)}</p>
      <p class="h-kasse__info">So viel Bargeld sollte da sein</p>
      <div class="h-teile">${teil}</div>
      <p class="h-kasse__satz">${t.D >= 0.005 ? `${esc(t.vorne.name)} hat sich ${euro(t.D)} mehr ausgezahlt.` : "Gewinn wird 50/50 geteilt."}</p>
      ${ausgleich}
      ${erstattungen.length ? `<div class="h-kasse__erstatten">
        <p class="h-kasse__titel">Noch zu erstatten</p>
        ${erstattungen.map((x) => `<div class="h-kasse__zeile"><span>${esc(x.bezahlt_von)}: ${esc(x.kategorie)} · ${euro(x.betrag)}</span><button class="h-pill h-pill--klein h-pill--hell" type="button" data-aktion="erstatten" data-id="${esc(x.id)}">Erstatten</button></div>`).join("")}
      </div>` : ""}
      <div class="h-kasse__knoepfe">
        <button class="h-pill h-pill--hell" type="button" data-aktion="auszahlung-neu">Auszahlung</button>
        <button class="h-pill h-pill--hell" type="button" data-aktion="ausgabe-neu">Ausgabe</button>
      </div>
    </section>

    <section class="h-abschnitt">
      <div class="h-abschnitt__kopf"><h2><span class="h-ico" style="--c:#13A06B" aria-hidden="true"><svg viewBox="0 0 24 24">${H_ICON.geld}</svg></span>Bewegungen</h2>${bewegungen.length > 6 ? `<a class="h-link" href="#geld/bewegungen">Alle</a>` : ""}</div>
      ${bewegungen.length ? `<div class="h-bews">${bewegungen.slice(0, 6).map(hBewegungKachel).join("")}</div>` : `<p class="h-leer">Noch keine Bewegungen.</p>`}
    </section>`;
}

/* ===================== Kalender (eigene Ansicht, liest nur) ===================== */

// Aufträge und Termine, die im Kalender stehen (wie in der Edge Function: kein abgesagter, keine abgelehnte Anfrage)
const kalEintraege = () => daten.auftraege.filter((a) => a.datum && !a.abgesagt && a.termin_status !== "abgelehnt");

function kalDauer(a) {
  if (istTermin(a)) return Number(a.dauer_min) || zahl(daten.einstellungen[0]?.slot_minuten) || 60;
  return dauerVon(a).min || 60;
}

// Belegte Zeiten einer Woche laden (Google + Blocker); im Testmodus nur Blocker
async function kalBelegtLaden(montag) {
  const schluessel = isoAusDatum(montag);
  if (H.belegt[schluessel]?.status === "laedt") return;
  H.belegt[schluessel] = { status: "laedt", liste: [] };
  const bis = tagPlus(montag, 7);
  try {
    let liste;
    if (db.lokal) {
      liste = daten.blocker.map((b) => ({ start: b.von, ende: b.bis, quelle: "blocker" }));
    } else {
      const { data: { session } } = await supa.auth.getSession();
      const res = await fetch(`${CFG.SUPABASE_URL}/functions/v1/bestaetigen`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ aktion: "belegt", von: montag.toISOString(), bis: bis.toISOString() }),
      });
      const antwort = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(antwort.fehler || `Status ${res.status}`);
      liste = antwort.belegt || [];
    }
    H.belegt[schluessel] = { status: "ok", liste, zeit: Date.now() };
  } catch (e) {
    H.belegt[schluessel] = { status: "fehler", liste: [], fehler: e.message, zeit: Date.now() };
  }
  if (route().bereich === "kalender") renderSpaeter();
}

// Alles, was an einem Tag im Kalender steht, sortiert: eigene Einträge + graue „Belegt“-Blöcke
function kalTagListe(tag, belegt) {
  const von = new Date(tag.getFullYear(), tag.getMonth(), tag.getDate());
  const bis = tagPlus(von, 1);
  const eigene = kalEintraege()
    .map((a) => {
      const start = new Date(a.datum);
      return { art: "eintrag", a, start, ende: new Date(start.getTime() + kalDauer(a) * 60000) };
    })
    .filter((x) => x.start >= von && x.start < bis);
  // Blöcke aus dem eigenen Klar-Glas-Kalender, die zu einem Auftrag gehören, nicht doppelt zeigen
  const alleEigenen = kalEintraege().map((a) => {
    const s = new Date(a.datum).getTime();
    return [s, s + kalDauer(a) * 60000];
  });
  const blocks = (belegt?.liste || [])
    .map((b) => ({ art: "belegt", quelle: b.quelle, start: new Date(b.start), ende: new Date(b.ende) }))
    .filter((b) => b.start < bis && b.ende > von)
    .filter((b) => b.quelle !== "eigen" || !alleEigenen.some(([s, e]) => s < b.ende.getTime() && e > b.start.getTime()))
    .map((b) => ({ ...b, start: b.start < von ? von : b.start, ende: b.ende > bis ? bis : b.ende, ganz: b.start <= von && b.ende >= bis }));
  return [...eigene, ...blocks].sort((x, y) => x.start - y.start);
}

const kalFarbe = (x) =>
  x.art === "belegt" ? "grau" : x.a.vorlaeufig || x.a.termin_status === "angefragt" ? "flamingo" : istTermin(x.a) ? "traube" : zahl(x.a.bekommen) !== null ? "gruen" : "blau";

function kalBelegtFuer(montag) {
  const schluessel = isoAusDatum(montag);
  const b = H.belegt[schluessel];
  // Nach 5 Minuten neu holen
  if (!b || (b.status !== "laedt" && Date.now() - (b.zeit || 0) > 300000)) setTimeout(() => kalBelegtLaden(montag), 0);
  return b;
}

function kalHinweis(b) {
  if (!b || b.status === "laedt") return `<p class="h-fuss">Belegte Zeiten aus Google werden geladen …</p>`;
  if (b.status === "fehler") return `<p class="h-fuss h-minus">Belegte Zeiten gingen nicht: ${esc(b.fehler)}</p>`;
  return "";
}

function hKalender() {
  const tag = H.kalTag || new Date();
  const montag = montagVon(tag);
  const belegt = kalBelegtFuer(montag);
  const heute = new Date().toDateString();
  const eintraege = kalEintraege();
  const tage = Array.from({ length: 7 }, (_, i) => tagPlus(montag, i));

  const streifen = tage.map((d) => {
    const hat = eintraege.some((a) => new Date(a.datum).toDateString() === d.toDateString());
    const gewaehlt = d.toDateString() === tag.toDateString();
    return `<button class="h-woche__tag${gewaehlt ? " ist-gewaehlt" : ""}${d.toDateString() === heute ? " ist-heute" : ""}" type="button" data-h="kal-tag" data-wert="${isoAusDatum(d)}" aria-pressed="${gewaehlt}" aria-label="${esc(fmtTagLang.format(d))}">
      <small>${esc(WOCHENTAGE_KURZ[(d.getDay() + 6) % 7].charAt(0))}</small>
      <b>${d.getDate()}</b>
      <i class="${hat ? "ist-da" : ""}"></i>
    </button>`;
  }).join("");

  const liste = kalTagListe(tag, belegt);
  const zeilen = liste.map((x) => {
    const zeit = x.ganz ? `<b>ganztags</b>` : `<b>${esc(hUhr(x.start))}</b><small>${esc(hUhr(x.ende))}</small>`;
    if (x.art === "belegt") {
      return `<div class="h-kal-zeile h-kal-zeile--belegt"><span class="h-kal-zeile__zeit">${zeit}</span><span class="h-kal-zeile__balken h-kal-zeile__balken--grau"></span>
        <span class="h-zeile__text"><span class="h-zeile__titel">Belegt</span><span class="h-zeile__unter">${x.quelle === "blocker" ? "Blocker" : x.quelle === "eigen" ? "Klar-Glas-Kalender" : "Google-Kalender"}</span></span></div>`;
    }
    const a = x.a;
    const k = kundeVon(a.kunde_id);
    const marke = a.termin_status === "angefragt" ? " · Anfrage" : a.vorlaeufig ? " · vorläufig" : "";
    return `<div class="h-kal-zeile">
      <span class="h-kal-zeile__zeit">${zeit}</span><span class="h-kal-zeile__balken h-kal-zeile__balken--${kalFarbe(x)}"></span>
      <button class="h-zeile__text h-ziel" type="button" data-aktion="termin-karte" data-id="${esc(a.id)}">
        <span class="h-zeile__titel">${esc(auftragName(a))}${istTermin(a) ? ` <span class="h-art">${esc(auftragTitel(a))}</span>` : ""}<span class="h-leise">${marke}</span></span>
        <span class="h-zeile__unter">${istTermin(a) ? "" : `${esc(a.leistung || "")}`}${k?.adresse ? `${istTermin(a) ? "" : " · "}${esc(k.adresse)}` : ""}</span>
      </button>${hChev}
    </div>`;
  }).join("");

  return `
    ${hKopf({ titel: "Kalender", ueber: esc(fmtMonat.format(tag)), rechts: `<button class="h-leiste__text" type="button" data-h="kal-heute">Heute</button>` })}
    <div class="h-woche" data-h-woche>
      <button class="h-woche__pfeil" type="button" data-h="kal-woche" data-wert="-1" aria-label="Vorige Woche">‹</button>
      <div class="h-woche__tage">${streifen}</div>
      <button class="h-woche__pfeil" type="button" data-h="kal-woche" data-wert="1" aria-label="Nächste Woche">›</button>
    </div>
    <section class="h-abschnitt">
      <div class="h-abschnitt__kopf"><h2>${esc(hTagText(tag) === fmtTag.format(tag) ? fmtTagLang.format(tag) : `${hTagText(tag)}, ${fmtTagMonat.format(tag)}`)}</h2></div>
      ${zeilen ? `<div class="h-gruppe h-gruppe--kal">${zeilen}</div>` : `<p class="h-leer h-leer--klein">Nichts geplant.</p>`}
      ${kalHinweis(belegt)}
    </section>
    <p class="h-fuss">Neue Termine landen automatisch im Google-Kalender „Klar Glas“. Grau = dort schon belegt.</p>`;
}

// Wochenansicht für den Computer (ersetzt den eingebetteten Google-Kalender)
function kalWoche() {
  const tag = H.kalTag || new Date();
  const montag = montagVon(tag);
  const belegt = kalBelegtFuer(montag);
  const tage = Array.from({ length: 7 }, (_, i) => tagPlus(montag, i));
  const heute = new Date().toDateString();
  const listen = tage.map((d) => kalTagListe(d, belegt));
  // Stundenbereich: 8–20 Uhr, erweitert, wenn etwas früher oder später liegt
  let vonH = 8, bisH = 20;
  listen.flat().filter((x) => !x.ganz).forEach((x) => {
    vonH = Math.min(vonH, x.start.getHours());
    bisH = Math.max(bisH, Math.min(24, x.ende.getHours() + (x.ende.getMinutes() ? 1 : 0)));
  });
  const STD = 48; // Pixel pro Stunde
  const pos = (d) => ((d.getHours() + d.getMinutes() / 60) - vonH) * STD;
  const jetzt = new Date();

  const spalten = tage.map((d, i) => {
    const bloecke = listen[i].map((x) => {
      const top = x.ganz ? 0 : Math.max(0, pos(x.start));
      const hoehe = x.ganz ? (bisH - vonH) * STD : Math.max(22, pos(x.ende) - top);
      if (x.art === "belegt") {
        return `<div class="kal-block kal-block--grau" style="top:${top}px;height:${hoehe}px"><b>Belegt</b><span>${x.ganz ? "ganztags" : `${esc(hUhr(x.start))}–${esc(hUhr(x.ende))}`}</span></div>`;
      }
      const a = x.a;
      return `<button class="kal-block kal-block--${kalFarbe(x)}" type="button" style="top:${top}px;height:${hoehe}px" data-aktion="termin-karte" data-id="${esc(a.id)}">
        <b>${esc(auftragName(a))}</b><span>${esc(hUhr(x.start))}${istTermin(a) ? ` · ${esc(auftragTitel(a))}` : a.leistung ? ` · ${esc(a.leistung)}` : ""}</span></button>`;
    }).join("");
    const linie = d.toDateString() === heute && jetzt.getHours() >= vonH && jetzt.getHours() < bisH ? `<span class="kal-jetzt" style="top:${pos(jetzt)}px"></span>` : "";
    return `<div class="kal-spalte${d.toDateString() === heute ? " ist-heute" : ""}" style="height:${(bisH - vonH) * STD}px">${bloecke}${linie}</div>`;
  }).join("");

  const kopf = tage.map((d) => `<div class="kal-kopf__tag${d.toDateString() === heute ? " ist-heute" : ""}"><small>${esc(WOCHENTAGE_KURZ[(d.getDay() + 6) % 7])}</small><b>${d.getDate()}</b></div>`).join("");
  const stunden = Array.from({ length: bisH - vonH }, (_, i) => `<span style="top:${i * STD}px">${String(vonH + i).padStart(2, "0")}:00</span>`).join("");

  return `<section class="karte kal-karte" aria-label="Woche">
    <div class="kal-leiste">
      <div class="zeitraum__nav">
        <button class="knopf knopf--klein knopf--leise" type="button" data-h="kal-woche" data-wert="-1" aria-label="Vorige Woche">‹</button>
        <h2 class="zeitraum__titel">${esc(fmtTagMonat.format(montag))} – ${esc(fmtTagMonat.format(tagPlus(montag, 6)))}</h2>
        <button class="knopf knopf--klein knopf--leise" type="button" data-h="kal-woche" data-wert="1" aria-label="Nächste Woche">›</button>
      </div>
      <button class="knopf knopf--klein" type="button" data-h="kal-heute">Heute</button>
      <ul class="kal-farben" aria-label="Farben">
        <li><i class="kal-punkt--blau"></i>Auftrag</li><li><i class="kal-punkt--gruen"></i>bezahlt</li><li><i class="kal-punkt--flamingo"></i>vorläufig / Anfrage</li><li><i class="kal-punkt--traube"></i>Termin</li><li><i class="kal-punkt--grau"></i>belegt</li>
      </ul>
    </div>
    <div class="kal-raster">
      <div class="kal-kopf"><span></span>${kopf}</div>
      <div class="kal-koerper"><div class="kal-stunden" style="height:${(bisH - vonH) * STD}px">${stunden}</div>${spalten}</div>
    </div>
    ${kalHinweis(belegt).replace("h-fuss", "hinweis")}
  </section>`;
}

/* ===================== Einstellungen + Team ===================== */

function hEinstellungen() {
  const p = preise();
  const zahlFeld = (feld, titel, wert, einheit, schritt = "0.5") => `<label class="h-zeile h-zeile--feld">
      <span class="h-zeile__text"><span class="h-zeile__titel">${titel}</span></span>
      <span class="h-feld"><input type="number" inputmode="decimal" min="0" step="${schritt}" value="${esc(wert)}" data-einstell="true" data-einstell-field="${feld}" aria-label="${titel}" /><span>${einheit}</span></span>
    </label>`;
  const passwortDa = !$("[data-passwort-setzen]").hidden;
  const abmeldenDa = !$("[data-abmelden]").hidden;
  return `
    ${hKopf({ titel: "Einstellungen", zurueck: "#uebersicht", zurueckText: "Zurück" })}
    ${hAbschnitt("Fensterreinigung", [
      zahlFeld("preis_normal", "Normales Fenster", p.preis_normal, "€"),
      zahlFeld("preis_boden", "Bodentiefes Fenster", p.preis_boden, "€"),
      zahlFeld("mindestpreis", "Mindestauftrag", p.mindestpreis, "€", "1"),
    ].join(""), { fuss: "Kleinere Aufträge werden auf den Mindestauftrag aufgerundet." })}
    ${hAbschnitt("Nachbarschaftshilfe & Felgen", zahlFeld("stundensatz", "Stundenlohn", p.stundensatz, "€"), { fuss: "Vorschlag für neue Aufträge, im Auftrag änderbar." })}
    ${hAbschnitt("Team", [
      zahlFeld("anteil_prozent", "Anteil pro Kopf", standardAnteil(), "%", "1"),
      hZeile({ href: "#team", titel: "Team & Mitarbeiter", rechts: `<span class="h-leise">${2 + aktiveMitarbeiter().length}</span>` }),
    ].join(""), { fuss: "So viel nimmt jeder, der mitarbeitet, bar mit. Seid ihr beide dabei, geht alles in die Kasse." })}
    ${hAbschnitt("Termine", hZeile({ href: "#zeiten", titel: "Wann wir können", unter: "Öffnungszeiten, Dauer, Kalender, Blocker" }))}
    ${hAbschnitt("Mitteilungen", `<div class="h-zeile h-zeile--schalter">
        <span class="h-zeile__text"><span class="h-zeile__titel">Bei neuen Anfragen</span><span class="h-zeile__unter">${esc(pushText())}</span></span>
        <button class="h-schalter" type="button" role="switch" aria-checked="${pushAn}" aria-label="Mitteilungen" data-aktion="push-umschalten"><span></span></button>
      </div>`, { fuss: "Gilt nur für dieses Gerät." })}
    ${passwortDa || abmeldenDa ? hAbschnitt("Konto", [
      passwortDa ? hZeile({ ziel: 'data-h="passwort"', titel: "Passwort ändern" }) : "",
      abmeldenDa ? hZeile({ ziel: 'data-h="abmelden"', titel: '<span class="h-minus">Abmelden</span>', chevron: false }) : "",
    ].join("")) : ""}
    <p class="h-fuss">Die Preise auf der Website ändern sich dadurch nicht automatisch.</p>`;
}

function hTeam() {
  const alle = [...daten.mitarbeiter].sort((a, b) => (a.aktiv === false) - (b.aktiv === false) || a.name.localeCompare(b.name, "de"));
  const zeile = (name, rolle) => {
    const z = personZahlen(name);
    return hZeile({
      href: `#mitarbeiter/${encodeURIComponent(name)}`,
      links: hAvatar(name),
      titel: esc(name),
      unter: `${rolle} · ${z.einsaetze.length} ${z.einsaetze.length === 1 ? "Einsatz" : "Einsätze"}`,
      rechts: euro(z.lohn),
      inset: 62,
    });
  };
  return `
    ${hKopf({ titel: "Team", zurueck: "#einstellungen", zurueckText: "Einstellungen" })}
    ${hAbschnitt("Chefs", PERSONEN.map((n) => zeile(n, "Chef")).join(""))}
    <section class="h-abschnitt">
      <div class="h-abschnitt__kopf"><h2>Mitarbeiter</h2></div>
      <div class="h-gruppe">
        ${alle.map((m) => zeile(m.name, m.aktiv === false ? "archiviert" : "Mitarbeiter")).join("")}
        <button class="h-neu" type="button" data-aktion="mitarbeiter-neu">${hIcon(H_ICON.plus)}Mitarbeiter hinzufügen</button>
      </div>
      <p class="h-fuss">Rechts steht, was jeder bisher an Lohn bekommen hat.</p>
    </section>`;
}

const hMitarbeiter = (id) => `${hKopf({ titel: decodeURIComponent(id || ""), zurueck: "#team", zurueckText: "Team", nurLeiste: true })}<div class="h-alt">${ansichtMitarbeiter(id)}</div>`;
const hZeiten = () => `${hKopf({ titel: "Wann wir können", zurueck: "#einstellungen", zurueckText: "Zurück", nurLeiste: true })}<div class="h-alt">${ansichtZeiten()}</div>`;

const HANDY = {
  uebersicht: hUebersicht,
  kunden: hKunden,
  kunde: hKunde,
  kalender: hKalender,
  geld: hGeld,
  aufgaben: hAufgaben,
  einstellungen: hEinstellungen,
  team: hTeam,
  mitarbeiter: hMitarbeiter,
  zeiten: hZeiten,
};

/* ===================== Nach jedem Zeichnen: Leiste, Tabs, Übergang ===================== */

function hTiefeVon(bereich, id) {
  if (H_TABS.includes(bereich) && !id) return 0;
  if (bereich === "mitarbeiter") return 3;
  if (bereich === "team") return 2;
  return 1;
}

function hNachRender(bereich, id) {
  const kopf = $("[data-h-kopf]", inhalt);
  const leiste = $("[data-h-leiste]");
  const zurueck = $("[data-h-zurueck]", leiste);
  const rechts = $("[data-h-leiste-rechts]", leiste);
  $("[data-h-leiste-titel]", leiste).textContent = kopf?.dataset.titel || "";
  leiste.classList.toggle("ist-nur-leiste", Boolean(kopf?.classList.contains("h-kopf--leiste")));
  if (kopf?.dataset.zurueck) {
    zurueck.hidden = false;
    $("span", zurueck).textContent = H.stapel.length ? hStapelText() : kopf.dataset.zurueckText;
  } else {
    zurueck.hidden = true;
  }
  const vorlage = kopf && $("template[data-h-rechts]", kopf);
  rechts.innerHTML = vorlage ? vorlage.innerHTML : `<button class="h-ich" type="button" data-h="panel" aria-label="Menü für ${esc(ich)}" aria-haspopup="dialog">${esc((ich || "?").charAt(0))}</button>`;

  const tab = { kunde: "kunden", team: "", mitarbeiter: "", einstellungen: "", zeiten: "" }[bereich] ?? bereich;
  document.querySelectorAll("[data-h-tabs] a").forEach((a) => {
    if (a.dataset.ziel === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.body.classList.toggle("ohne-fab", ["einstellungen", "team", "mitarbeiter", "zeiten"].includes(bereich) || (bereich === "geld" && id === "bewegungen"));

  // Seitenwechsel: tiefer = von rechts, zurück = von links, Tab = kurz einblenden
  const hash = location.hash || "#uebersicht";
  const tiefe = hTiefeVon(bereich, id);
  if (H.hash !== null && hash !== H.hash) {
    if (tiefe > H.tiefe) H.stapel.push({ hash: H.hash, titel: $("[data-h-leiste-titel]").dataset.vorher || "" });
    if (tiefe === 0) H.stapel = [];
    if (!H.ohneAnimation) hUebergang(tiefe > H.tiefe ? "rein" : tiefe < H.tiefe ? "raus" : "tab");
  }
  H.ohneAnimation = false;
  H.hash = hash;
  H.tiefe = tiefe;
  $("[data-h-leiste-titel]").dataset.vorher = kopf?.dataset.titel || "";
  hScroll();
}

function hStapelText() {
  const t = H.stapel[H.stapel.length - 1]?.titel || "Zurück";
  return t.startsWith("Hallo") ? "Übersicht" : t.length > 14 ? "Zurück" : t;
}

function hUebergang(art) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const frames = {
    rein: [{ transform: "translateX(100%)", boxShadow: "-12px 0 30px rgba(0,0,0,.08)" }, { transform: "none", boxShadow: "none" }],
    raus: [{ transform: "translateX(-28%)", opacity: 0.6 }, { transform: "none", opacity: 1 }],
    tab: [{ opacity: 0 }, { opacity: 1 }],
  }[art];
  try {
    inhalt.animate(frames, { duration: art === "tab" ? 160 : 460, easing: art === "tab" ? "ease-out" : H_FEDER_SANFT });
  } catch {
    /* ohne Web Animations: einfach ohne */
  }
}

function hZurueck() {
  const kopf = $("[data-h-kopf]", inhalt);
  const ziel = H.stapel.pop()?.hash || kopf?.dataset.zurueck || "#uebersicht";
  location.hash = ziel;
}

// Großer Titel → kleiner Titel in der Leiste
function hScroll() {
  if (!document.body.classList.contains("handy")) return;
  const leiste = $("[data-h-leiste]");
  const titel = $(".h-titel", inhalt);
  const grenze = leiste.getBoundingClientRect().bottom;
  const eingeklappt = !titel || titel.getBoundingClientRect().bottom < grenze + 4;
  leiste.classList.toggle("ist-eingeklappt", eingeklappt);
  leiste.classList.toggle("hat-schatten", window.scrollY > 2 || !titel);
}

/* ===================== Panel (L-Kreis) und FAB ===================== */

function hPanelAuf() {
  const p = $("[data-h-panel]");
  $("[data-h-panel-name]", p).textContent = ich;
  $("[data-h-panel-ava]", p).textContent = (ich || "?").charAt(0);
  $("[data-h-panel-push]", p).setAttribute("aria-checked", String(pushAn));
  $("[data-h-panel-passwort]", p).hidden = $("[data-passwort-setzen]").hidden;
  $("[data-h-panel-abmelden]", p).hidden = $("[data-abmelden]").hidden;
  p.hidden = false;
  p.offsetWidth;
  p.classList.add("ist-offen");
  document.documentElement.classList.add("h-gesperrt");
  hVibe();
}

function hPanelZu() {
  const p = $("[data-h-panel]");
  if (p.hidden) return;
  p.classList.remove("ist-offen");
  $(".h-panel__karte", p).style.transform = "";
  document.documentElement.classList.remove("h-gesperrt");
  setTimeout(() => !p.classList.contains("ist-offen") && (p.hidden = true), 380);
}

function hFab(auf) {
  const f = $("[data-h-fab]");
  const offen = auf ?? !f.classList.contains("ist-offen");
  f.classList.toggle("ist-offen", offen);
  $("[data-h=fab]", f).setAttribute("aria-expanded", String(offen));
  document.documentElement.classList.toggle("h-gesperrt", offen);
  if (offen) hVibe();
}

/* ===================== Gesten ===================== */

// Zeilen nach links wischen
function hWischGesten() {
  let zeile = null, startX = 0, startY = 0, dx = 0, richtung = null, basis = 0;
  const breite = (w) => $(".h-wisch__aktionen", w).offsetWidth;
  const alleZu = (ausser) => document.querySelectorAll("[data-h-wisch].ist-offen").forEach((w) => {
    if (w === ausser) return;
    w.classList.remove("ist-offen");
    $(".h-wisch__vorne", w).style.transform = "";
  });

  document.addEventListener("touchstart", (e) => {
    const w = e.target.closest?.("[data-h-wisch]");
    if (!w || e.target.closest(".h-wisch__aktionen")) {
      if (!e.target.closest?.(".h-wisch__aktionen")) alleZu();
      return;
    }
    alleZu(w);
    zeile = w;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dx = 0;
    richtung = null;
    basis = w.classList.contains("ist-offen") ? -breite(w) : 0;
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!zeile) return;
    const x = e.touches[0].clientX - startX;
    const y = e.touches[0].clientY - startY;
    if (!richtung && Math.abs(x) + Math.abs(y) > 8) richtung = Math.abs(x) > Math.abs(y) ? "x" : "y";
    if (richtung !== "x") return;
    e.preventDefault();
    const b = breite(zeile);
    let pos = basis + x;
    if (pos > 0) pos = pos / 4;
    if (pos < -b) pos = -b - (-b - pos) / 3;
    dx = x;
    const vorne = $(".h-wisch__vorne", zeile);
    vorne.style.transition = "none";
    vorne.style.transform = `translateX(${pos}px)`;
  }, { passive: false });

  document.addEventListener("touchend", () => {
    if (!zeile) return;
    const w = zeile;
    zeile = null;
    if (richtung !== "x") return;
    const vorne = $(".h-wisch__vorne", w);
    vorne.style.transition = "";
    const auf = basis + dx < -breite(w) / 2;
    w.classList.toggle("ist-offen", auf);
    vorne.style.transform = auf ? `translateX(${-breite(w)}px)` : "";
    if (auf) hVibe(6);
    w.dataset.gewischt = "1";
    setTimeout(() => delete w.dataset.gewischt, 50);
  });

  // Tippen auf eine offene oder gerade gewischte Zeile schließt nur
  document.addEventListener("click", (e) => {
    const w = e.target.closest?.("[data-h-wisch]");
    if (!w || e.target.closest(".h-wisch__aktionen")) return;
    if (w.classList.contains("ist-offen") || w.dataset.gewischt) {
      e.preventDefault();
      e.stopImmediatePropagation();
      alleZu();
    }
  }, true);
}

// Vom linken Rand wischen = zurück
function hKantenGeste() {
  let start = null, dx = 0, t0 = 0, aktiv = false;
  document.addEventListener("touchstart", (e) => {
    if (!document.body.classList.contains("handy") || H.tiefe === 0 || document.querySelector("dialog[open]")) return;
    const x = e.touches[0].clientX;
    if (x > 22) return;
    start = { x, y: e.touches[0].clientY };
    dx = 0;
    t0 = Date.now();
    aktiv = false;
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!start) return;
    const x = e.touches[0].clientX - start.x;
    const y = e.touches[0].clientY - start.y;
    if (!aktiv && Math.abs(y) > Math.abs(x) && Math.abs(y) > 10) {
      start = null;
      return;
    }
    if (x > 6) aktiv = true;
    if (!aktiv) return;
    e.preventDefault();
    dx = Math.max(0, x);
    inhalt.style.transition = "none";
    inhalt.style.transform = `translateX(${dx}px)`;
    inhalt.style.boxShadow = "-12px 0 30px rgba(0,0,0,.08)";
  }, { passive: false });
  document.addEventListener("touchend", () => {
    if (!start) return;
    start = null;
    if (!aktiv) return;
    const schnell = dx / Math.max(1, Date.now() - t0) > 0.5;
    const weg = dx > window.innerWidth * 0.33 || (schnell && dx > 40);
    inhalt.style.transition = `transform 300ms ${H_FEDER_SANFT}`;
    inhalt.style.transform = weg ? "translateX(100%)" : "";
    setTimeout(() => {
      inhalt.style.transition = "";
      inhalt.style.boxShadow = "";
      if (weg) {
        H.ohneAnimation = true;
        inhalt.style.transform = "";
        hZurueck();
        hUebergang("raus");
      }
    }, weg ? 260 : 300);
  });
}

// Sheets nach unten wegwischen (Formulare, Terminkarte, Diagramm)
function hSheetGeste(el, schliessen) {
  let start = null, dy = 0, t0 = 0;
  el.addEventListener("touchstart", (e) => {
    if (!document.body.classList.contains("handy")) return;
    if (e.target.closest("input, textarea, select, .h-diagramm, .chips, .h-chips")) return;
    const scroller = e.target.closest(".dialog__form, .terminkarte, .diagramm-popup__inhalt") || el;
    if (scroller.scrollTop > 0 || el.scrollTop > 0) return;
    start = e.touches[0].clientY;
    dy = 0;
    t0 = Date.now();
  }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    if (start === null) return;
    dy = e.touches[0].clientY - start;
    if (dy <= 0) {
      el.style.transform = "";
      return;
    }
    e.preventDefault();
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  el.addEventListener("touchend", () => {
    if (start === null) return;
    start = null;
    const schnell = dy / Math.max(1, Date.now() - t0) > 0.6;
    if (dy > 120 || (schnell && dy > 40)) {
      el.style.transition = `transform 240ms ${H_FEDER_SANFT}`;
      el.style.transform = "translateY(100%)";
      hVibe(6);
      setTimeout(() => {
        schliessen();
        el.style.transition = "";
        el.style.transform = "";
      }, 230);
    } else {
      el.style.transition = `transform 380ms ${H_FEDER}`;
      el.style.transform = "";
      setTimeout(() => (el.style.transition = ""), 400);
    }
  });
}

// Panel nach oben wegwischen
function hPanelGeste() {
  const p = $("[data-h-panel]");
  const karte = $(".h-panel__karte", p);
  let start = null, dy = 0;
  karte.addEventListener("touchstart", (e) => {
    start = e.touches[0].clientY;
    dy = 0;
  }, { passive: true });
  karte.addEventListener("touchmove", (e) => {
    if (start === null) return;
    dy = Math.min(0, e.touches[0].clientY - start);
    karte.style.transition = "none";
    karte.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  karte.addEventListener("touchend", () => {
    if (start === null) return;
    start = null;
    karte.style.transition = "";
    if (dy < -50) hPanelZu();
    else karte.style.transform = "";
  });
}

// Im Wochenstreifen links/rechts wischen = andere Woche
function hWochenGeste() {
  let start = null;
  document.addEventListener("touchstart", (e) => {
    if (!e.target.closest?.("[data-h-woche]")) return;
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    start = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) hWocheWechseln(dx < 0 ? 1 : -1);
  });
}

function hWocheWechseln(um) {
  const tag = H.kalTag || new Date();
  H.kalTag = tagPlus(tag, um * 7);
  hVibe(5);
  render();
  const tage = $(".h-woche__tage", inhalt);
  if (tage && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    try {
      tage.animate([{ transform: `translateX(${um * 40}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 320, easing: H_FEDER_SANFT });
    } catch {
      /* egal */
    }
  }
}

/* ===================== Bedienung ===================== */

function hKlick(e) {
  const el = e.target.closest("[data-h]");
  // FAB-Knöpfe: Menü zu, die Aktion selbst läuft über data-aktion in app.js
  if (e.target.closest("[data-h-fab-aktion]")) {
    hFab(false);
    return;
  }
  // Panel: Links schließen es, außen tippen auch
  const panel = $("[data-h-panel]");
  if (!panel.hidden && (e.target === panel || e.target.closest("[data-h-panel-schleier], [data-h-panel] a"))) {
    hPanelZu();
    if (!e.target.closest("a")) return;
  }
  if (!el) return;
  const { h, wert, id } = el.dataset;
  switch (h) {
    case "zurueck":
      return hZurueck();
    case "panel":
      return hPanelAuf();
    case "fab":
      return hFab();
    case "fab-zu":
      return hFab(false);
    case "push":
      hPanelZu();
      return pushUmschalten();
    case "passwort":
      hPanelZu();
      return $("[data-passwort-setzen]").click();
    case "abmelden":
      hPanelZu();
      return $("[data-abmelden]").click();
    case "zu-geld":
      if (wert === "kz") {
        location.hash = "#geld";
        return;
      }
      H.geldChart = wert;
      H.balken = null;
      location.hash = "#geld";
      return;
    case "geld-chart":
      H.geldChart = wert;
      H.balken = null;
      hVibe(5);
      return render();
    case "balken": {
      const i = Number(el.dataset.i);
      H.balken = H.balken === i ? null : i;
      hVibe(5);
      return render();
    }
    case "balken-weg":
      H.balken = null;
      return render();
    case "kal-tag":
      H.kalTag = new Date(`${wert}T12:00`);
      hVibe(5);
      return render();
    case "kal-woche":
      return hWocheWechseln(Number(wert));
    case "kal-heute":
      H.kalTag = new Date();
      return render();
    case "haken": {
      const a = daten.aufgaben.find((x) => x.id === id);
      if (!a || el.dataset.laeuft) return;
      el.dataset.laeuft = "1";
      el.setAttribute("aria-checked", String(!a.erledigt));
      el.closest(".h-aufgabe")?.classList.toggle("ist-erledigt", !a.erledigt);
      hVibe(10);
      setTimeout(async () => {
        await aendern("aufgaben", id, { erledigt: !a.erledigt });
        render();
      }, 420);
      return;
    }
    case "aufgabe-loeschen": {
      const w = el.closest("[data-h-wisch]");
      if (w) {
        w.style.transition = `opacity 200ms ease, transform 240ms ${H_FEDER_SANFT}`;
        w.style.opacity = "0";
        w.style.transform = "translateX(-30%)";
      }
      hVibe(10);
      setTimeout(async () => {
        await loeschen("aufgaben", id);
        zeigeToast("Aufgabe gelöscht");
        render();
      }, 200);
      return;
    }
  }
}

/* ===================== Lade-Animation ===================== */

function hLadeFertig() {
  const l = $("[data-h-lade]");
  if (!l || l.classList.contains("ist-fertig")) return;
  l.classList.add("ist-fertig");
  setTimeout(() => l.remove(), 400);
}

/* ===================== Einrichten (am Ende von app.js aufgerufen) ===================== */

function hEinrichten() {
  document.addEventListener("click", hKlick);
  window.addEventListener("scroll", hScroll, { passive: true });
  hWischGesten();
  hKantenGeste();
  hPanelGeste();
  hWochenGeste();
  hSheetGeste(dialog, () => $("[data-dialog-zu]", dialogForm)?.click() || dialog.close());
  hSheetGeste(terminkarte, () => terminkarte.close());
  hSheetGeste(diagrammDialog, () => diagrammDialog.close());

  // Tab antippen, auf dem man schon ist: nach oben scrollen
  $("[data-h-tabs]").addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    hVibe(5);
    if (a.getAttribute("aria-current") === "page") {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
  // Eingeklappte „Erledigt“-Liste merkt sich ihren Zustand
  document.addEventListener("toggle", (e) => {
    if (e.target.matches?.("[data-h-erledigt]")) H.erledigtOffen = e.target.open;
  }, true);
  // Escape schließt Panel und FAB
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    hPanelZu();
    hFab(false);
  });
}
