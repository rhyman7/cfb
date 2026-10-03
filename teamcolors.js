// Team colors: TEAM_COLORS[team name] = [primary, secondary], for every FBS and FCS team.
// From ESPN's team list (cfb_teams in sportsdataverse/cfbfastR-cfb-data: color and
// alternate_color), keyed by the same name data.json uses. The primary fills the team's
// block; the secondary letters it on the matchup page. teamColors() derives readable
// versions of both for the dark page and for print. A team missing here gets a neutral block.
const TEAM_COLORS = {
  "Abilene Christian": ["#592D82", "#B1B3B3"],
  "Air Force": ["#003594", "#FFFFFF"],
  "Akron": ["#041E42", "#C5B783"],
  "Alabama": ["#9E1B32", "#FFFFFF"],
  "Alabama A&M": ["#790000", "#FFFFFF"],
  "Alabama State": ["#E9A900", "#0A0A0A"],
  "Alcorn State": ["#4B0058", "#46166A"],
  "App State": ["#000000", "#FFCD00"],
  "Arizona": ["#CC0033", "#003366"],
  "Arizona State": ["#FFC627", "#8C1D40"],
  "Arkansas": ["#A32136", "#FFFFFF"],
  "Arkansas State": ["#CC092F", "#000000"],
  "Arkansas-Pine Bluff": ["#E0AA0F", "#EAAA00"],
  "Army": ["#000000", "#D3BC8D"],
  "Auburn": ["#002B5C", "#F26522"],
  "Austin Peay": ["#8E0B0B"],
  "BYU": ["#0047BA", "#002E5D"],
  "Ball State": ["#BA0C2F", "#FFFFFF"],
  "Baylor": ["#154734", "#FFB81C"],
  "Bethune-Cookman": ["#7B1831", "#E9AA12"],
  "Boise State": ["#0033A0", "#D64309"],
  "Boston College": ["#8C2232", "#DBCCA6"],
  "Bowling Green": ["#FD5000", "#4F2C1D"],
  "Brown": ["#411E09", "#949300"],
  "Bryant": ["#000000", "#9F8343"],
  "Bucknell": ["#000060", "#00316E"],
  "Buffalo": ["#005BBB", "#FFFFFF"],
  "Butler": ["#0D1361", "#00A3E0"],
  "Cal Poly": ["#1E4D2B", "#EED897"],
  "California": ["#041E42", "#FFC72C"],
  "Campbell": ["#000000"],
  "Central Arkansas": ["#A7A9AC", "#8E959A"],
  "Central Connecticut": ["#1B49A2", "#D1D5D8"],
  "Central Michigan": ["#4C0027", "#FBAB18"],
  "Charleston Southern": ["#2E3192", "#DED090"],
  "Charlotte": ["#005035", "#A49665"],
  "Chattanooga": ["#00386B", "#DCA71D"],
  "Cincinnati": ["#000000", "#E00122"],
  "Clemson": ["#F56600", "#FFFFFF"],
  "Coastal Carolina": ["#006F71", "#A27752"],
  "Colgate": ["#821019", "#FFFFFF"],
  "Colorado": ["#CFB87C", "#000000"],
  "Colorado State": ["#004C23", "#C8C372"],
  "Columbia": ["#7BA4DB", "#183863"],
  "Cornell": ["#B31B1B", "#FFFFFF"],
  "Dartmouth": ["#005730", "#000000"],
  "Davidson": ["#000000", "#E51837"],
  "Dayton": ["#004B8D", "#FFFFFF"],
  "Delaware": ["#00539F", "#FFD200"],
  "Delaware State": ["#009CDB", "#D51C28"],
  "Drake": ["#005596", "#BEC0C2"],
  "Duke": ["#00539B", "#FFFFFF"],
  "Duquesne": ["#002D62", "#B90B2E"],
  "East Carolina": ["#582C83", "#FFC72C"],
  "East Tennessee State": ["#002D61", "#FFC423"],
  "East Texas A&M": ["#000000"],
  "Eastern Illinois": ["#000000", "#BEBAB9"],
  "Eastern Kentucky": ["#660819", "#F0F0F0"],
  "Eastern Michigan": ["#006938", "#FFFFFF"],
  "Eastern Washington": ["#A10022", "#ABB4BC"],
  "Elon": ["#020303", "#B59A57"],
  "Florida": ["#0021A5", "#FA4616"],
  "Florida A&M": ["#F89728", "#00843D"],
  "Florida Atlantic": ["#003366", "#CC0000"],
  "Florida International": ["#091F3F", "#C3993F"],
  "Florida State": ["#782F40", "#CEB888"],
  "Fordham": ["#830032", "#909090"],
  "Fresno State": ["#B1102B", "#13284C"],
  "Furman": ["#582C83", "#FFFFFF"],
  "Gardner-Webb": ["#C12535", "#909090"],
  "Georgetown": ["#110E42", "#001C58"],
  "Georgia": ["#BA0C2F", "#2C2A29"],
  "Georgia Southern": ["#041E42", "#A3AAAE"],
  "Georgia State": ["#0039A6", "#FFFFFF"],
  "Georgia Tech": ["#B3A369", "#FFFFFF"],
  "Grambling": ["#EE8601", "#FFD10A"],
  "Hampton": ["#0067AC"],
  "Harvard": ["#990000", "#DBDBDB"],
  "Hawai'i": ["#005737", "#000000"],
  "Holy Cross": ["#582C83", "#FFFFFF"],
  "Houston": ["#C8102E", "#FFFFFF"],
  "Houston Christian": ["#00539C"],
  "Howard": ["#003A63", "#E51937"],
  "Idaho": ["#000000", "#8C6E4A"],
  "Idaho State": ["#EF8C00", "#E9A126"],
  "Illinois": ["#FF5F05", "#13294B"],
  "Illinois State": ["#CE1126", "#FFE716"],
  "Incarnate Word": ["#000000", "#080808"],
  "Indiana": ["#970310", "#FFFFFF"],
  "Indiana State": ["#00669A", "#F0F0F0"],
  "Iowa": ["#231F20", "#FCD116"],
  "Iowa State": ["#AE192D", "#FFC72A"],
  "Jackson State": ["#123297", "#B5B7BA"],
  "Jacksonville State": ["#CC0000", "#000000"],
  "James Madison": ["#450084", "#CBB677"],
  "Kansas": ["#0051BA", "#E8000D"],
  "Kansas State": ["#330A57", "#E2E3E4"],
  "Kennesaw State": ["#FDBB30", "#0B1315"],
  "Kent State": ["#002664", "#EAAB00"],
  "Kentucky": ["#0033A0", "#FFFFFF"],
  "LSU": ["#461D76", "#FDD023"],
  "Lafayette": ["#790000", "#A59474"],
  "Lamar": ["#000000", "#EBEBEB"],
  "Lehigh": ["#6C2B2A", "#B69E70"],
  "Liberty": ["#0A254E", "#B72025"],
  "Lindenwood": ["#000000"],
  "Louisiana": ["#CE181E", "#000000"],
  "Louisiana Tech": ["#003087", "#CB333B"],
  "Louisville": ["#C9001F", "#FFFFFF"],
  "Maine": ["#127DBE"],
  "Marist": ["#E53730", "#F0F0F0"],
  "Marshall": ["#00B140", "#000000"],
  "Maryland": ["#CE1126", "#FFFFFF"],
  "Massachusetts": ["#881C1C", "#FFFFFF"],
  "McNeese": ["#00529C"],
  "Memphis": ["#004991", "#8E908F"],
  "Mercer": ["#FF7F29", "#080808"],
  "Mercyhurst": ["#000000"],
  "Merrimack": ["#000000"],
  "Miami": ["#F47423", "#035131"],
  "Miami (OH)": ["#C41230", "#FFFFFF"],
  "Michigan": ["#00274C", "#FFCB05"],
  "Michigan State": ["#173F35", "#FFFFFF"],
  "Middle Tennessee": ["#036EB7", "#FFFFFF"],
  "Minnesota": ["#5E0A2F", "#FAB41C"],
  "Mississippi State": ["#5D1725", "#C1C6C8"],
  "Mississippi Valley State": ["#005328", "#CF2D34"],
  "Missouri": ["#F1B82D", "#000000"],
  "Missouri State": ["#5E0009", "#FFFFFF"],
  "Monmouth": ["#051844"],
  "Montana": ["#751D4A", "#666666"],
  "Montana State": ["#00205C", "#BC955C"],
  "Morehead State": ["#094FA3", "#FED91A"],
  "Morgan State": ["#014786", "#F47937"],
  "Murray State": ["#002148", "#000E00"],
  "NC State": ["#CC0000", "#FFFFFF"],
  "Navy": ["#00225B", "#B5A67C"],
  "Nebraska": ["#E31937", "#FFFFFF"],
  "Nevada": ["#041E42", "#8A8D8F"],
  "New Hampshire": ["#004990", "#C3C4C6"],
  "New Haven": ["#041E42", "#FFC425"],
  "New Mexico": ["#BA0C2F", "#A7A8AA"],
  "New Mexico State": ["#7E141B", "#231F20"],
  "Nicholls": ["#C41230", "#F0F0F0"],
  "Norfolk State": ["#0C8968", "#FDB813"],
  "North Alabama": ["#000000"],
  "North Carolina": ["#7BAFD4", "#13294B"],
  "North Carolina A&T": ["#0505AA", "#004684"],
  "North Carolina Central": ["#880023", "#C2C3C0"],
  "North Dakota": ["#00A26B", "#C2C3C0"],
  "North Dakota State": ["#01402A", "#FFFFFF"],
  "North Texas": ["#068F33", "#FFFFFF"],
  "Northern Arizona": ["#003976", "#1B3069"],
  "Northern Colorado": ["#13558D", "#FFC533"],
  "Northern Illinois": ["#C8102E", "#000000"],
  "Northern Iowa": ["#473282", "#FFFFFF"],
  "Northwestern": ["#492F92", "#FFFFFF"],
  "Northwestern State": ["#492F91", "#ED6118"],
  "Notre Dame": ["#062340", "#C99700"],
  "Ohio": ["#154734", "#FFFFFF"],
  "Ohio State": ["#BA0C2F", "#A8ADB4"],
  "Oklahoma": ["#990000", "#FFFFFF"],
  "Oklahoma State": ["#FE5C00", "#000000"],
  "Old Dominion": ["#003768", "#A1D2F1"],
  "Ole Miss": ["#13294B", "#CF142B"],
  "Oregon": ["#00934B", "#FFF41B"],
  "Oregon State": ["#DC4405", "#000000"],
  "Penn State": ["#061440", "#FFFFFF"],
  "Pennsylvania": ["#082A74", "#A6163D"],
  "Pittsburgh": ["#003594", "#FFB81C"],
  "Portland State": ["#00311E", "#EBEBEB"],
  "Prairie View A&M": ["#582C83", "#EAAA00"],
  "Presbyterian": ["#194896", "#990134"],
  "Princeton": ["#000000", "#FF6000"],
  "Purdue": ["#CEB888", "#000000"],
  "Rhode Island": ["#091F3F", "#5AB3E8"],
  "Rice": ["#00205B", "#C1C6C8"],
  "Richmond": ["#9E0712", "#B90B2E"],
  "Robert Morris": ["#00214D", "#A21D2B"],
  "Rutgers": ["#CE0E2D", "#FFFFFF"],
  "SE Louisiana": ["#215732", "#FFC72C"],
  "SMU": ["#A80000", "#0033A1"],
  "Sacramento State": ["#00573C", "#CDB97D"],
  "Sacred Heart": ["#A40012", "#C29472"],
  "Sam Houston": ["#F56423", "#FFFFFF"],
  "Samford": ["#005485", "#BC0023"],
  "San Diego": ["#2F99D4", "#2F99D4"],
  "San Diego State": ["#A6192E", "#000000"],
  "San José State": ["#0038A8", "#FFB81A"],
  "South Alabama": ["#00205B", "#BF0D3E"],
  "South Carolina": ["#73000A", "#000000"],
  "South Carolina State": ["#7D1315", "#104897"],
  "South Dakota": ["#CD1241", "#F0F0F0"],
  "South Dakota State": ["#0033A0", "#FFD100"],
  "South Florida": ["#006747", "#CFC493"],
  "Southeast Missouri State": ["#C8102E", "#000000"],
  "Southern": ["#004B97", "#FFC82D"],
  "Southern Illinois": ["#85283D", "#C2C3C0"],
  "Southern Miss": ["#FFC72C", "#231F20"],
  "Southern Utah": ["#C72026", "#000000"],
  "St. Thomas": ["#000000"],
  "Stanford": ["#8C1515", "#FFFFFF"],
  "Stephen F. Austin": ["#393996", "#BEC0C2"],
  "Stetson": ["#0A5640", "#56854E"],
  "Stonehill": ["#000000"],
  "Stony Brook": ["#990000"],
  "Syracuse": ["#000E54", "#FF431B"],
  "TCU": ["#4D1979", "#FFFFFF"],
  "Tarleton State": ["#000000"],
  "Temple": ["#A41E35", "#FFFFFF"],
  "Tennessee": ["#FF8200", "#FFFFFF"],
  "Tennessee State": ["#171796", "#F0F0F0"],
  "Tennessee Tech": ["#5A4099", "#FFDE00"],
  "Texas": ["#AF5C37", "#FFFFFF"],
  "Texas A&M": ["#500000", "#FFFFFF"],
  "Texas Southern": ["#860038", "#FFFFFF"],
  "Texas State": ["#501214", "#6A5638"],
  "Texas Tech": ["#DA291C", "#000000"],
  "The Citadel": ["#7BADD3", "#002856"],
  "Toledo": ["#0B2240", "#FFCD00"],
  "Towson": ["#FFC229"],
  "Troy": ["#862633", "#B1B1B1"],
  "Tulane": ["#006747", "#418FDE"],
  "Tulsa": ["#003595", "#D0B787"],
  "UAB": ["#1A5632", "#FDB913"],
  "UAlbany": ["#3D2777", "#FFFFFF"],
  "UC Davis": ["#002855", "#C3C4C6"],
  "UCF": ["#000000", "#B4A169"],
  "UCLA": ["#2774AE", "#F2A900"],
  "UConn": ["#0C2340", "#A2AAAD"],
  "UL Monroe": ["#840029", "#FDB913"],
  "UNLV": ["#CF0A2C", "#CAC8C8"],
  "USC": ["#9D2235", "#FFC72C"],
  "UT Martin": ["#FF6700", "#102A5C"],
  "UTEP": ["#FF8200", "#041E42"],
  "UTSA": ["#0C2340", "#F15A22"],
  "Utah": ["#BE0000", "#FFFFFF"],
  "Utah State": ["#0F2439", "#FFFFFF"],
  "Utah Tech": ["#000000"],
  "VMI": ["#AE122A", "#000000"],
  "Valparaiso": ["#794500"],
  "Vanderbilt": ["#000000", "#CFAE70"],
  "Villanova": ["#00205B", "#13B5EA"],
  "Virginia": ["#232D4B", "#F84C1E"],
  "Virginia Tech": ["#6A2C3E", "#CF4520"],
  "Wagner": ["#00483A", "#FFFFFF"],
  "Wake Forest": ["#CEB888", "#2C2A29"],
  "Washington": ["#33006F", "#E8D3A2"],
  "Washington State": ["#A60F2D", "#4D4D4D"],
  "Weber State": ["#18005A", "#EBEBEB"],
  "West Georgia": ["#0033A1", "#DB1A21"],
  "West Virginia": ["#EAAA00", "#002855"],
  "Western Carolina": ["#492F91", "#BF9E70"],
  "Western Illinois": ["#4E1E8A", "#FFC90A"],
  "Western Kentucky": ["#E13A3E", "#FFFFFF"],
  "Western Michigan": ["#532E1F", "#F1C500"],
  "William & Mary": ["#115740", "#F0B323"],
  "Wisconsin": ["#A00000", "#FFFFFF"],
  "Wofford": ["#533B23", "#F0F0F0"],
  "Wyoming": ["#492F24", "#FFC425"],
  "Yale": ["#004A81", "#286DC0"],
  "Youngstown State": ["#E51936", "#690717"]
};
const TC_FALLBACK = ["#3A3F47", "#F2F1EE"];   // a team the table doesn't know
const TC_PANEL = "#1b1d21", TC_PAPER = "#ffffff", TC_DARK = "#111214";

function tcRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
}
function tcLum(hex) {
  const [r, g, b] = tcRgb(hex).map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function tcContrast(a, b) {
  const x = tcLum(a), y = tcLum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function tcHsl(hex) {
  const [r, g, b] = tcRgb(hex), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function tcHex(h, s, l) {
  const f = (p, q, t) => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const rgb = s ? [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)] : [l, l, l];
  return "#" + rgb.map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}
// The same hue, made lighter (dir 1), darker (dir -1) or whichever is closer (dir 0)
// until it reads against bg.
function tcReadable(hex, bg, floor, dir) {
  if (tcContrast(hex, bg) >= floor) return hex;
  const [h, s, l] = tcHsl(hex);
  for (let step = 1; step <= 100; step++) {
    for (const d of dir ? [dir] : [1, -1]) {
      const x = l + (d * step) / 100;
      if (x < 0 || x > 1) continue;
      const c = tcHex(h, s, x);
      if (tcContrast(c, bg) >= floor) return c;
    }
  }
  return tcContrast("#ffffff", bg) >= tcContrast(TC_DARK, bg) ? "#ffffff" : TC_DARK;
}

const TC_CACHE = {};
// bg: the block's fill. on: black or white lettering on it. on2: the secondary color as
// lettering on it (the blocks use this). ink: the team color as text, bars and dials on the dark page.
// inkp: the same for print.
function teamColors(key) {
  if (TC_CACHE[key]) return TC_CACHE[key];
  const [bg, sec] = TEAM_COLORS[key] || TC_FALLBACK;
  const on = tcContrast("#ffffff", bg) >= tcContrast(TC_DARK, bg) ? "#ffffff" : TC_DARK;
  const on2 = sec ? tcReadable(sec, bg, 4.5, 0) : on;
  // a black or gray primary with a colorful secondary: the secondary carries the team on the page
  const base = tcHsl(bg)[1] < 0.15 && sec && tcHsl(sec)[1] > 0.3 ? sec : bg;
  return (TC_CACHE[key] = {
    bg, on, on2,
    ink: tcReadable(base, TC_PANEL, 4.6, 1),
    inkp: tcReadable(base, TC_PAPER, 4.5, -1),
  });
}
// Inline custom properties for an element that shows one team.
function teamVars(key) {
  const c = teamColors(key);
  return `--tc:${c.bg};--tc-on:${c.on};--tc-on2:${c.on2};--tc-ink:${c.ink};--tc-inkp:${c.inkp}`;
}
// The team's block: its abbreviation, lettered in the secondary color, on its primary color.
function slabHtml(abbr, key) {
  const a = String(abbr || "");
  return `<span class="slab${a.length > 4 ? " long" : ""}" style="${teamVars(key)}">${a.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span>`;
}
