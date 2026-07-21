const ealStationMap = {
    0: "HTD", 15: "SSG_S", 151: "SSG_N", 16: "LWM_S", 161: "LWM_N", 17: "S1", 701: "HTD", 901: "HTD_N",
    24: "ADT", 241: "ADT_1", 1: "HUH_1", 2: "MKK", 3: "KOT", 4: "TAW", 5: "SHT", 6: "FOT", 7: "RAC",
    8: "UNI", 9: "TAP", 10: "TWO", 11: "FAN", 12: "SHS", 13: "LOW", 14: "LMC", 21: "HUH", 22: "EXC",
    23: "ADM", 91: "HTD", 92: "HTD_1", 81: "TEST", 82: "TEST_1"
};
const tmlStationMap = {
    1: "HUH", 14: "ETS", 21: "TAW", 22: "CKT", 23: "STW", 24: "CIO", 25: "SHM", 26: "TSH", 27: "HEO",
    28: "MOS", 29: "WKS", 41: "NAC", 42: "MEF", 43: "TWW", 44: "KSR", 45: "YUL", 46: "LOP", 47: "TIS",
    48: "SIH", 49: "TUM", 50: "AUS", 61: "HOM", 62: "TKW", 63: "SUW", 64: "KAT", 65: "DIH", 66: "HIK",
    91: "DEP", 92: "OUT", 93: "SPC", 94: "TES", 95: "WR", 97: "MOL"
};

let stationLoc, stations, lines;
let eal_main, eal_low, eal_lmc, eal_rac, tml_main, ktl_main, ael_main, drl_main, isl_main, tcl_main, tkl_main,
    tkl_lhp, twl_main, sil_main;

let drawnPolylines = {};
const defaultVisibility = {
    lines: {
        eal: true, tml: true, ktl: true, ael: true, drl: true,
        isl: true, tcl: true, tkl: true, twl: true, sil: true
    },
    trains: {EAL: true, TML: true}
};
const savedVisibility = localStorage.getItem('map_visibility');
let currentVisibility = savedVisibility ? JSON.parse(savedVisibility) : JSON.parse(JSON.stringify(defaultVisibility));

let apiUrl;

// 動態注入 MapLibre 樣式修復 (去除預設 Padding、修正 Cursor、縮小可點擊範圍)
const style = document.createElement('style');
style.innerHTML = `
    .maplibregl-popup-content { padding: 0 !important; background: transparent !important; box-shadow: none !important; pointer-events: auto; }
    .maplibregl-popup-close-button { right: 8px !important; top: 8px !important; color: #fff !important; font-size: 20px !important; z-index: 1000; font-weight: bold; background: rgba(0,0,0,0.3) !important; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; }
    .maplibregl-popup-tip { display: none !important; }
    .maplibregl-marker { cursor: pointer !important; width: max-content; height: max-content; }
`;
document.head.appendChild(style);

window.addEventListener("DOMContentLoaded", async () => {
    const urlParams = new URLSearchParams(window.location.search);

    const [locRes, lineRes, stRes, nameRes] = await Promise.all([
        fetch('./data/location.json').then(r => r.json()),
        fetch('./data/line.json').then(r => r.json()),
        fetch('./data/station.json').then(r => r.json()),
        fetch('./data/name.json').then(r => r.json())
    ]);
    stationLoc = locRes;
    lines = nameRes;
    stations = stRes;
    ({
        eal_main, eal_low, eal_lmc, eal_rac, tml_main, ktl_main, ael_main, drl_main,
        isl_main, tcl_main, tkl_main, tkl_lhp, twl_main, sil_main
    } = lineRes);

    const apiHash = "Pt9cbvp5fMcH9phDnzSPskMqEIhky0ywV7hbZP5dnadu6VAYJzybR6puG0F07Vu9";
    const expectedHash = "hKbXg61WeSYL9ENsTyyBsw==";
    const secretSalt = "real-time-train-status";

    let savedKey = localStorage.getItem("code");
    if (!savedKey || encryptInput(savedKey, secretSalt) !== expectedHash) {
        while (true) {
            let key = prompt("Code:");
            if (key && encryptInput(key, secretSalt) === expectedHash) {
                localStorage.setItem("code", key);
                apiUrl = decryptInput(apiHash, key);
                break;
            }
        }
    } else {
        apiUrl = decryptInput(apiHash, savedKey);
    }
    setTimeout(initMap, 1000);
});

let trainInterval = null, trainController = null;
let stationInterval = null, rtController = null, ntController = null;
let hkoInterval = null, hkoController = null;

let openedStation = null, openedWindow = null, openedType = "Roctec";

document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
        if (!trainInterval) {
            await fetchTrainData();
            trainInterval = setInterval(fetchTrainData, 5000);
        }
        if (openedWindow && openedStation) {
            clearInterval(stationInterval);
            await fetchNextTrain(openedStation);
            await fetchRoctec(openedStation);
            stationInterval = setInterval(() => {
                fetchNextTrain(openedStation);
                fetchRoctec(openedStation);
            }, 5000);
        }
    }
    else {
        [trainInterval, stationInterval, hkoInterval].forEach(i => i && clearInterval(i));
        [trainController, rtController, ntController, hkoController].forEach(c => c && c.abort());
        trainInterval = stationInterval = hkoInterval = null;
        trainController = rtController = ntController = hkoController = null;
    }
});

let map, spherical;
let ealData, tmlData, ktlData, islData, twlData, tklData, tclData;
let weatherIcons = [], temperature = null;
let allMarkers = [];

async function initMap() {
    spherical = {
        computeDistanceBetween: (a, b) => turf.distance([a.lng, a.lat], [b.lng, b.lat], {units: 'meters'}),
        computeLength: (path) => turf.length(turf.lineString(path.map(p => [p.lng, p.lat])), {units: 'meters'}),
        interpolate: (a, b, fraction) => {
            if (a.lat === b.lat && a.lng === b.lng) return a;
            const line = turf.lineString([[a.lng, a.lat], [b.lng, b.lat]]);
            const length = turf.length(line, {units: 'meters'});
            const pt = turf.along(line, length * fraction, {units: 'meters'});
            return {lat: pt.geometry.coordinates[1], lng: pt.geometry.coordinates[0]};
        }
    };

    let center = stationLoc["HTD"];
    let zoom = 12;

    const savedView = localStorage.getItem("last_map_view");
    if (savedView) {
        try {
            const parsed = JSON.parse(savedView);
            center = {lat: parsed.lat, lng: parsed.lng};
            zoom = parsed.zoom;
        } catch (e) {}
    }

    const initialStyle = document.getElementById("styleSelector")?.value || "liberty";
    const styleUrl = initialStyle === "3d" ? "https://tiles.openfreemap.org/styles/liberty" : `https://tiles.openfreemap.org/styles/${initialStyle}`;

    map = new maplibregl.Map({
        container: "map",
        style: styleUrl,
        center: [center.lng, center.lat],
        zoom: zoom,
        pitch: initialStyle === "3d" ? 60 : 0
    });

    map.on("click", () => {
        // 修復：移除時只呼叫 remove()，剩餘清除工作交由 pop 的 'close' 事件處理，避免發生 null properties error
        if (openedWindow) {
            openedWindow.remove();
        }
    });

    map.on("moveend", () => {
        const center = map.getCenter();
        const settings = { lat: center.lat, lng: center.lng, zoom: map.getZoom() };
        localStorage.setItem("last_map_view", JSON.stringify(settings));
    });

    const loadMapData = async () => {
        if (document.getElementById("styleSelector")?.value === "3d" && !map.getLayer('3d-buildings')) {
            map.addLayer({
                'id': '3d-buildings',
                'source': 'openmaptiles',
                'source-layer': 'building',
                'type': 'fill-extrusion',
                'minzoom': 13,
                'paint': {
                    'fill-extrusion-color': '#aaa',
                    'fill-extrusion-height': ['get', 'render_height'],
                    'fill-extrusion-base': ['get', 'render_min_height'],
                    'fill-extrusion-opacity': 0.8
                }
            });
        }
        await drawLines();
        applyVisibility();
    };

    map.on('load', async () => {
        await drawStations();
        await loadMapData();
        setupDisplayMenu();

        document.getElementById('toggleMenuBtn').classList.add('visible');

        if (!trainInterval) {
            await fetchTrainData();
            trainInterval = setInterval(fetchTrainData, 5000);
        }
        await fetchHKOData();
        hkoInterval = setInterval(fetchHKOData, 60000);
    });

    document.getElementById("styleSelector")?.addEventListener("change", (e) => {
        const val = e.target.value;
        const url = val === "3d" ? "https://tiles.openfreemap.org/styles/liberty" : `https://tiles.openfreemap.org/styles/${val}`;
        map.setStyle(url);
        map.setPitch(val === "3d" ? 60 : 0);
        map.once('styledata', loadMapData);
    });
}

function applyVisibility() {
    Object.keys(drawnPolylines).forEach(line => (drawnPolylines[line] || []).forEach(p => p.setMap(currentVisibility.lines[line])));

    Object.keys(stationMarkers).forEach(station => {
        const isVisible = Object.keys(currentVisibility.lines).some(lineKey =>
            currentVisibility.lines[lineKey] && lines[lineKey] && lines[lineKey].stations && lines[lineKey].stations.split(" ").includes(station.toLowerCase())
        );
        if (stationMarkers[station]) stationMarkers[station].getElement().style.display = isVisible ? 'block' : 'none';
    });

    Object.values(trainMarkers).forEach(m => {
        if (m.customLineType) m.getElement().style.display = currentVisibility.trains[m.customLineType] ? 'block' : 'none';
    });
}

function setupDisplayMenu() {
    const visMenuOverlay = document.getElementById('visMenuOverlay');
    const visCheckboxes = document.getElementById('visCheckboxes');

    visCheckboxes.addEventListener('change', (e) => {
        if (e.target.tagName === 'INPUT') {
            currentVisibility[e.target.dataset.type][e.target.dataset.key] = e.target.checked;
            localStorage.setItem('map_visibility', JSON.stringify(currentVisibility));
            applyVisibility();
        }
    });

    document.getElementById('toggleMenuBtn').addEventListener('click', () => {
        visCheckboxes.innerHTML = '';
        Object.keys(currentVisibility.lines).forEach(line => {
            const lineInfo = lines[line.toLowerCase()] || {name: line.toUpperCase(), color: '#777'};
            visCheckboxes.insertAdjacentHTML('beforeend', `
                <label class="vis-label pointer w-100">
                    <input type="checkbox" data-type="lines" data-key="${line}" ${currentVisibility.lines[line] ? 'checked' : ''}> 
                    <span class="vis-span text-white font-bold text-center" style="background-color: ${lineInfo.color};">
                        ${lineInfo.name}
                    </span>
                </label>
            `);
        });

        visCheckboxes.insertAdjacentHTML('beforeend', `<hr class="vis-divider w-100">`);

        Object.keys(currentVisibility.trains).forEach(train => {
            const lineInfo = lines[train.toLowerCase()] || {name: train + " Line", color: '#777'};
            visCheckboxes.insertAdjacentHTML('beforeend', `
                <label class="vis-label pointer w-100">
                    <input type="checkbox" data-type="trains" data-key="${train}" ${currentVisibility.trains[train] ? 'checked' : ''}> 
                    <span class="vis-span text-white font-bold text-center" style="background-color: ${lineInfo.color};">
                        ${lineInfo.name} Train Location
                    </span>
                </label>
            `);
        });

        visMenuOverlay.classList.add('visible');
    });

    document.getElementById('visCloseBtn').addEventListener('click', () => visMenuOverlay.classList.remove('visible'));
    visMenuOverlay.addEventListener('click', (e) => {
        if (e.target === visMenuOverlay) visMenuOverlay.classList.remove('visible');
    });

    document.getElementById('visSelectAllBtn').addEventListener('click', () => {
        Object.keys(currentVisibility.lines).forEach(k => currentVisibility.lines[k] = true);
        Object.keys(currentVisibility.trains).forEach(k => currentVisibility.trains[k] = true);
        localStorage.setItem('map_visibility', JSON.stringify(currentVisibility));
        document.getElementById('toggleMenuBtn').click();
        applyVisibility();
    });
}

async function fetchTrainData() {
    try {
        if (trainController) trainController.abort();

        trainController = new AbortController();
        const {signal} = trainController;
        const lineNames = ["EAL", "TML", "KTL", "ISL", "TWL", "TKL", "TCL"];

        [ealData, tmlData, ktlData, islData, twlData, tklData, tclData] = await Promise.all(lineNames.map(line =>
            fetch(`${apiUrl}line=${line}`, {signal})
                .then(res => res.ok ? res.json() : Promise.reject(`${line} fetch failed`))
        ));

        await Promise.all([
            updateEALTrainLocations(ealData),
            updateTMLTrainLocations(tmlData)
        ]);
    } catch (e) {
        if (e.name !== "AbortError") console.error("Train data fetch error:", e);
    } finally {
        trainController = null;
    }
}

async function fetchRoctec(station) {
    if (!station) return;
    try {
        if (rtController) rtController.abort();
        rtController = new AbortController();

        const response = await fetch(`${apiUrl}station=${station}`, {signal: rtController.signal});
        if (response.ok) {
            await updateStationData(station, await response.json(), "Roctec");
        }
    } catch (e) {
        if (e.name !== "AbortError") console.error("Error fetching station data:", e);
    } finally {
        rtController = null;
    }
}

async function fetchNextTrain(station) {
    if (!station) return; // 修復 null.toLowerCase() 報錯
    try {
        if (ntController) ntController.abort();
        ntController = new AbortController();

        let merged = {curr_time: null, data: {}};
        const validLines = Object.keys(lines).filter(l => l !== "nsl" && l !== "ewl");

        await Promise.all(validLines.map(async (line) => {
            if (lines[line].stations.split(" ").includes(station.toLowerCase())) {
                const res = await fetch(`https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${line.toUpperCase()}&sta=${station}`, {signal: ntController.signal});
                if (res.ok) {
                    const data = await res.json();
                    merged.curr_time = data.curr_time;
                    Object.assign(merged.data, data.data);
                }
            }
        }));
        await updateStationData(station, merged, "NextTrain");
    } catch (e) {
        if (e.name !== "AbortError") console.error("Error fetching NextTrain:", e);
    } finally {
        ntController = null;
    }
}

async function fetchHKOData() {
    try {
        if (hkoController) hkoController.abort();
        hkoController = new AbortController();
        const timeout = setTimeout(() => hkoController.abort(), 10000);

        const [rhrreadResp, warnsumResp] = await Promise.all([
            fetch("https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=en", {signal: hkoController.signal}),
            fetch("https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=en", {signal: hkoController.signal})
        ]);
        clearTimeout(timeout);

        if (rhrreadResp.ok && warnsumResp.ok) {
            const rData = await rhrreadResp.json();
            const wData = await warnsumResp.json();

            weatherIcons = rData.icon.map(n => `pic${n}.png`);
            const tempEntry = rData.temperature.data.find(e => e.place === "Hong Kong Observatory");
            temperature = tempEntry ? tempEntry.value : null;

            for (const key in wData) {
                if (wData[key].actionCode?.toUpperCase() !== "CANCEL") {
                    weatherIcons.push(`${wData[key].code.toLowerCase()}.png`);
                }
            }
        }
    } catch (e) {
        if (e.name !== "AbortError") console.error("Error fetching HKO:", e);
    } finally {
        hkoController = null;
    }
}

let roctecTrainData = [], ntTrainData = [], roctecLastUpdate, ntLastUpdate, stationMarkers = {};

async function updateStationData(station, data, type) {
    if (type === "Roctec") {
        roctecTrainData = [];
        roctecLastUpdate = data.gen_time;
        for (const line in data.line) {
            if (!lines[line.toLowerCase()]) continue;

            for (const plat in data.line[line]) {
                for (const train in data.line[line][plat]) {
                    const trip = data.line[line][plat][train];
                    let train0 = "-";
                    if (line === "EAL" || line === "NSL") {
                        train0 = ealData?.find(t => t.td === trip.td)?.trainId || "-";
                    } else {
                        const td = (trip.td || "").trim();
                        const tdNum = parseInt(td.slice(line === "TCL" ? -3 : -2), 10);
                        const dataMap = {KTL: ktlData, ISL: islData, TWL: twlData, TKL: tklData, TCL: tclData}[line];

                        const match = dataMap?.find(t => {
                            const ttd = (t.td || "").trim();
                            const tNum = parseInt(ttd.slice(line === "TCL" ? -3 : -2), 10);
                            if (Date.now() / 1000 - t.updatedTime > (line === "TCL" ? 600 : 300)) return false;
                            return ttd === td || ttd.endsWith(td) || (tNum === tdNum && !isNaN(tNum));
                        });
                        train0 = match ? (line === "TKL" ? match.trainId : match.trainConsist) : "-";
                    }
                    roctecTrainData.push({ line, plat, destination: trip.destination, trip: trip.td, train: train0, ttnt: trip.ttnt });
                }
            }
        }
    } else {
        ntTrainData = [];
        ntLastUpdate = data.curr_time;
        for (const ln in data.data) {
            const line = ln.split("-")[0];
            ["UP", "DOWN"].forEach(dir => {
                data.data[ln][dir]?.forEach(trip => ntTrainData.push({
                    line, plat: trip.plat, destination: trip.dest, ttnt: trip.ttnt
                }));
            });
        }
    }

    if (openedWindow && stationMarkers[station] === openedWindow.associatedMarker) {
        const renderTable = (isRoctec) => {
            let content = `
                <div class="info-window-container">
                    <div class="info-window-title text-center font-bold">${stations[station.toLowerCase()]}</div>
                    <div class="info-window-subtitle text-right text-gray">Last Update: ${isRoctec ? new Date(roctecLastUpdate).toLocaleString("zh-HK", {timeZone: "Asia/Hong_Kong"}) : ntLastUpdate}</div>
                    <div class="weather-container">
                        ${weatherIcons.map(icon => `<img src="public/${icon}" alt="" class="weather-icon">`).join('')}
                        <span class="weather-temp text-white">${temperature}°C</span>
                    </div>
                    <table class="data-table w-100">
                        <thead>
                            <tr class="bg-navy text-white">
                                <th class="table-cell">Destination</th>
                                ${isRoctec ? '<th class="table-cell">Trip</th><th class="table-cell">Train</th>' : ''}
                                <th class="table-cell">Plat.</th>
                                <th class="table-cell">TTNT</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            let currentLine = '';
            let currentColor = '#FFFFFF';

            (isRoctec ? roctecTrainData : ntTrainData).forEach((train) => {
                if (train.line !== currentLine) {
                    content += `
                        <tr>
                            <td colspan="${isRoctec ? 5 : 3}" class="line-header text-white font-bold" style="background-color: ${lines[train.line.toLowerCase()].color};">
                                ${lines[train.line.toLowerCase()].name}
                            </td>
                        </tr>`;
                    currentLine = train.line;
                    currentColor = '#FFFFFF';
                }
                const destText = stations[train.destination.toLowerCase()] ?? train.destination;
                let destHtml = `<td class="table-cell">${destText}</td>`;

                if (isRoctec && (train.line === "EAL" || train.line === "NSL")) {
                    const isRace = /[BGKN]/.test(train.trip);
                    destHtml = `
                        <td class="table-cell data-cell-marquee">
                            <div class="marquee-container">
                                <div class="marquee-text">
                                    ${isRace ? destText + ' via Racecourse' : destText}
                                </div>
                            </div>
                        </td>`;
                }

                content += `
                    <tr style="background-color: ${currentColor};">
                        ${destHtml}
                        ${isRoctec ? `<td class="table-cell">${train.trip}</td><td class="table-cell">${train.train}</td>` : ''}
                        <td class="table-cell">${train.plat}</td>
                        <td class="table-cell">${train.ttnt}</td>
                    </tr>`;
                currentColor = currentColor === '#FFFFFF' ? '#C5D9E4' : '#FFFFFF';
            });

            content += `
                        </tbody>
                    </table>
                    <div class="toggle-btn-container text-center">
                        <button id="toggleBtn" class="toggle-btn pointer">${isRoctec ? 'NEXT TRAIN' : 'ROCTEC'}</button>
                    </div>
                </div>
            `;
            openedWindow.setHTML(content);

            const btn = document.getElementById('toggleBtn');
            if (btn) {
                btn.onclick = () => {
                    openedType = isRoctec ? "NextTrain" : "Roctec";
                    renderTable(!isRoctec);
                };
            }
            if (isRoctec) {
                document.querySelectorAll('.marquee-container').forEach(c => {
                    const t = c.querySelector('.marquee-text');
                    if (t && t.scrollWidth > c.clientWidth) t.classList.add('marquee-animate');
                });
            }
        };
        renderTable(openedType === "Roctec");
    }
}

async function drawLines() {
    drawnPolylines = {};
    [
        {path: eal_main, name: 'eal'}, {path: eal_rac, name: 'eal'}, {path: eal_low, name: 'eal'},
        {path: eal_lmc, name: 'eal'}, {path: tml_main, name: 'tml'}, {path: ktl_main, name: 'ktl'},
        {path: ael_main, name: 'ael'}, {path: drl_main, name: 'drl'}, {path: isl_main, name: 'isl'},
        {path: tcl_main, name: 'tcl'}, {path: tkl_main, name: 'tkl'}, {path: tkl_lhp, name: 'tkl'},
        {path: twl_main, name: 'twl'}, {path: sil_main, name: 'sil'}
    ].forEach(({path, name}, index) => {
        const sourceId = `line-source-${name}-${index}`;
        const layerId = `line-layer-${name}-${index}`;

        if (!map.getSource(sourceId)) {
            map.addSource(sourceId, {
                'type': 'geojson',
                'data': {
                    'type': 'Feature',
                    'properties': {},
                    'geometry': { 'type': 'LineString', 'coordinates': path.map(p => [p.lng, p.lat]) }
                }
            });
            map.addLayer({
                'id': layerId, 'type': 'line', 'source': sourceId,
                'layout': { 'line-join': 'round', 'line-cap': 'round', 'visibility': currentVisibility.lines[name] ? 'visible' : 'none' },
                'paint': { 'line-color': lines[name].color, 'line-width': 5 }
            });
        }
        if (!drawnPolylines[name]) drawnPolylines[name] = [];
        drawnPolylines[name].push({
            setMap: (show) => {
                if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', show ? 'visible' : 'none');
            }
        });
    });
}

function handleMarkerInteractions(element, originalZIndex) {
    element.originalZIndex = originalZIndex;
    element.style.zIndex = originalZIndex;

    // 修復 Marker 被覆蓋時無法點擊的問題（滑鼠懸停時置頂）
    element.addEventListener('mouseenter', () => { element.style.zIndex = 9999; });
    element.addEventListener('mouseleave', () => {
        if (openedWindow?.associatedMarker?.getElement() !== element) {
            element.style.zIndex = originalZIndex;
        }
    });
}

function setupInfoWindowClose(infoWindow) {
    infoWindow.on('close', () => {
        if (stationInterval) clearInterval(stationInterval);
        if (rtController) rtController.abort();
        if (ntController) ntController.abort();

        infoWindow.associatedMarker = null;
        openedStation = null;
        openedWindow = null;
        stationInterval = null;
        rtController = null;
        ntController = null;
        roctecTrainData = ntTrainData = [];
        roctecLastUpdate = ntLastUpdate = "Never";

        allMarkers.forEach(m => {
            if (m.getElement()) m.getElement().style.zIndex = m.getElement().originalZIndex || 100;
        });
    });

    infoWindow.on('open', () => {
        // 修復 InfoWindow 的層級問題 (永遠在最上層)
        if(infoWindow.getElement()) infoWindow.getElement().style.zIndex = 10000;
    });
}

async function drawStations() {
    const entries = Object.entries(stationLoc);
    for (let i = 0; i < entries.length; i++) {
        if ((i >= 16 && i <= 26) || i === 52) continue;

        const [station, location] = entries[i];
        const element = Object.assign(document.createElement("div"), {
            innerHTML: `<img src="public/${i <= 52 ? "station" : "mtr"}.png" alt="Station" class="marker-icon">`,
            className: "station-marker-wrapper"
        });

        handleMarkerInteractions(element, 100 + i);

        const stationMarker = new maplibregl.Marker({ element, anchor: 'center' })
            .setLngLat([location.lng, location.lat])
            .addTo(map);

        stationMarkers[station] = stationMarker;
        allMarkers.push(stationMarker);

        const infoWindow = new maplibregl.Popup({
            maxWidth: '1000px',
            offset: [0, -15], // 修復 InfoWindow 位置偏移問題
            closeButton: true,
            closeOnClick: false,
            className: 'custom-popup'
        });

        setupInfoWindowClose(infoWindow);

        element.addEventListener('click', (e) => {
            e.stopPropagation();

            if (openedWindow) openedWindow.remove();

            if (station === openedStation) return; // Toggle off

            roctecTrainData = ntTrainData = [];
            roctecLastUpdate = ntLastUpdate = "Never";

            infoWindow.associatedMarker = stationMarker;
            openedStation = station;
            openedWindow = infoWindow;

            infoWindow.setHTML(`
                <div class="info-window-container">
                    <div class="info-window-title font-bold text-center">${stations[station.toLowerCase()]}</div>
                </div>
            `).setLngLat([location.lng, location.lat]).addTo(map);

            fetchNextTrain(station);
            fetchRoctec(station);
            stationInterval = setInterval(() => { fetchNextTrain(station); fetchRoctec(station); }, 5000);

            allMarkers.forEach(m => { if(m.getElement()) m.getElement().style.zIndex = m.getElement().originalZIndex || 100; });
            element.style.zIndex = 9999;
        });
    }
}

function convertTMLStationOrder(code) {
    const stationMap = { 1: 16, 14: 17, 21: 9, 22: 8, 23: 7, 24: 6, 25: 5, 26: 4, 27: 3, 28: 2, 29: 1, 41: 19, 42: 20, 43: 21, 44: 22, 45: 23, 46: 24, 47: 25, 48: 26, 49: 27, 50: 18, 61: 15, 62: 14, 63: 13, 64: 12, 65: 11, 66: 10 };
    return stationMap[code] ?? 0;
}

function getTMLStationDistance(curr, next, distanceFromCurrentStation) {
    const upDist = [1300, 1080, 1110, 2870, 750, 1140, 960, 800, 1290, 4460, 1260, 1010, 1140, 1040, 780, 1130, 1710, 2770, 2410, 4390, 8930, 3540, 1040, 2340, 4950, 2100];
    const dnDist = [0, ...upDist];
    const isUp = convertTMLStationOrder(curr) < convertTMLStationOrder(next);
    const stationList = lines.tml.stations.toUpperCase().split(" ");
    const currIndex = stationList.findIndex(s => s.toUpperCase() === tmlStationMap[curr]);
    const nextIndex = stationList.findIndex(s => s.toUpperCase() === tmlStationMap[next]);

    return (currIndex === -1 || nextIndex === -1) ? 0 : Math.max((isUp ? upDist[currIndex] : dnDist[currIndex]) - distanceFromCurrentStation, 0);
}

function isPassengerTrain(td) {
    return td !== "UNKNOWN" && !["FF", "SS", "VL", "VT", "VV", "VW", "DP", "XX", "TT"].includes(td.slice(0, 2));
}

function getClosestSector(latLng, line, isSpur) {
    let sectorPoints = line === "EAL" ? (isSpur ? eal_lmc : eal_low).concat(eal_main) : tml_main;
    let closestSector = [];
    let closestDistance = Number.MAX_VALUE;

    for (let i = 0; i < sectorPoints.length - 1; i++) {
        const segmentLength = spherical.computeDistanceBetween(sectorPoints[i], sectorPoints[i + 1]);
        const steps = Math.max(5, Math.ceil(segmentLength / 20));

        for (let j = 0; j <= steps; j++) {
            const fraction = j / steps;
            const dist = spherical.computeDistanceBetween(spherical.interpolate(sectorPoints[i], sectorPoints[i + 1], fraction), latLng);
            if (dist < closestDistance) {
                closestDistance = dist;
                closestSector = [sectorPoints[i], sectorPoints[i + 1]];
            }
        }
    }
    return closestSector;
}

function getAllSectorPointsBetween(from, to, line, isSpur) {
    let sectorPoints = line === "EAL" ? (isSpur ? eal_lmc : eal_low).concat(eal_main) : tml_main;
    let fromSector = getClosestSector(from, line, isSpur);
    let toSector = getClosestSector(to, line, isSpur);

    if (toSector.every(p => fromSector.includes(p))) return [from, to];

    let start = sectorPoints.indexOf(fromSector[1]);
    let end = sectorPoints.indexOf(toSector[0]);
    let swapped = false;

    if (start > end) {
        swapped = true;
        start = sectorPoints.indexOf(toSector[1]);
        end = sectorPoints.indexOf(fromSector[0]);
    }

    let res = [swapped ? to : from];
    for (let i = start; i <= end; i++) res.push(sectorPoints[i]);
    res.push(swapped ? from : to);
    return swapped ? res.reverse() : res;
}

const trainPathCache = {};

function getTrainAt(trip, line) {
    const currentStationCode = Number(trip.currentStationCode);
    const nextStationCode = Number(trip.nextStationCode);
    const destinationStationCode = Number(trip.destinationStationCode);

    const currLatLng = stationLoc[(line === "EAL" ? ealStationMap : tmlStationMap)[currentStationCode]];
    const nextLatLng = stationLoc[(line === "EAL" ? ealStationMap : tmlStationMap)[nextStationCode]];
    const targetDistance = Number(line === "EAL" ? trip.targetDistance : getTMLStationDistance(currentStationCode, nextStationCode, trip.distanceFromCurrentStation));
    const startDistance = Number(line === "EAL" ? trip.startDistance : trip.distanceFromCurrentStation);

    if (currLatLng && nextLatLng && trip.targetDistance === 0 && isPassengerTrain(trip.td)) return null;
    if ((targetDistance === 0 && startDistance === 0) || startDistance > 10000) return currLatLng;
    if (startDistance > 10000) return currLatLng;
    if ([0, 701].includes(currentStationCode) && [0, 701].includes(nextStationCode)) return stationLoc[line === "EAL" ? "HTD" : "PHD"];

    const isSpur = currentStationCode === 14 || destinationStationCode === 14 || nextStationCode === 14;
    const cacheKey = `${line}-${currentStationCode}-${nextStationCode}-${isSpur}`;

    if (!trainPathCache[cacheKey]) {
        const sectors = getAllSectorPointsBetween(currLatLng, nextLatLng, line, isSpur);
        const totalLength = spherical.computeLength(sectors);
        const cumulativeDistances = [0];
        let currentDist = 0;
        for (let i = 0; i < sectors.length - 1; i++) {
            currentDist += spherical.computeDistanceBetween(sectors[i], sectors[i + 1]);
            cumulativeDistances.push(currentDist);
        }
        trainPathCache[cacheKey] = {sectors, totalLength, cumulativeDistances};
    }

    const cachedData = trainPathCache[cacheKey];
    const lengthBetweenCurrAndNext = cachedData.totalLength * (startDistance / (targetDistance + startDistance));

    let elapsedDistance = 0, segmentDistance = 0, sector = [cachedData.sectors[0], cachedData.sectors[1]];
    for (let i = 0; i < cachedData.sectors.length - 1; i++) {
        const distance = cachedData.cumulativeDistances[i + 1] - cachedData.cumulativeDistances[i];
        if (cachedData.cumulativeDistances[i] + distance >= lengthBetweenCurrAndNext) {
            sector = [cachedData.sectors[i], cachedData.sectors[i + 1]];
            elapsedDistance = cachedData.cumulativeDistances[i];
            segmentDistance = distance;
            break;
        }
    }
    if (segmentDistance === 0) return sector[0];
    return spherical.interpolate(sector[0], sector[1], (lengthBetweenCurrAndNext - elapsedDistance) / segmentDistance);
}

let trainMarkers = {};

async function updateEALTrainLocations(data) {
    let i = 0;
    for (const train of data) {
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));

        try {
            const position = getTrainAt(train, "EAL");
            if (!position) continue;

            const { trainId, trainSpeed, listCars, td, currentStationCode: csc, nextStationCode: nsc, destinationStationCode: dsc, receivedTime } = train;
            const isUp = parseInt(td.slice(-1)) % 2 !== 0;

            const getHtmlContent = () => {
                const currentStationCode = ealStationMap[csc] || 'Unknown';
                const nextStationCode = ealStationMap[nsc] || 'Unknown';
                const destinationStationCode = ealStationMap[dsc] || 'Unknown';

                return `<div class="train-info-container">
                    <div class="train-info-title font-bold text-center flex-center">${trainId} (T${Math.floor(trainId / 3)}) ${td} ${currentStationCode} to ${nextStationCode} (${destinationStationCode}) ${trainSpeed}km/h</div>
                    <div class="train-info-cars-wrapper flex-center"><div class="train-info-direction">&#x25C0;</div>
                    ${(isUp ? listCars : [...listCars].reverse()).map((car, idx) => {
                    const isFirstCl = (isUp && idx === 3) || (!isUp && idx === 5);
                    const bg = car.passengerCount < (isFirstCl ? 70 : 110) ? '#4CAF50' : car.passengerCount < (isFirstCl ? 150 : 250) ? '#CDDC39' : '#F44336';
                    return `<div class="train-info-car flex-center ${isFirstCl ? 'car-text-red' : 'text-white'}" style="background-color: ${bg};">${car.passengerCount}</div>`;
                }).join('')}</div></div>`;
            };

            const isNis = csc === 0 || Date.now() / 1000 - receivedTime > 60 || !isPassengerTrain(td);
            const newSrc = `public/r_train_${isNis ? 'unknown' : (isUp ? 'up' : 'dn')}.png`;

            if (trainMarkers[trainId]) {
                trainMarkers[trainId].setLngLat([position.lng, position.lat]);
                trainMarkers[trainId].getElement().style.display = currentVisibility.trains.EAL ? 'block' : 'none';

                const imgElement = trainMarkers[trainId].getElement().querySelector('img');
                if (!imgElement.src.includes(newSrc)) imgElement.src = newSrc;
                if (isNis && csc === 0) imgElement.classList.add('opacity-50');
                else imgElement.classList.remove('opacity-50');

                if (openedWindow?.associatedMarker === trainMarkers[trainId]) {
                    openedWindow.setHTML(getHtmlContent());
                }
            } else {
                const element = document.createElement("div");
                element.innerHTML = `<img src="${newSrc}" class="marker-icon train-marker-icon ${isNis && csc === 0 ? 'opacity-50' : ''}">`;
                element.style.display = currentVisibility.trains.EAL ? 'block' : 'none';

                handleMarkerInteractions(element, 200 + i);

                const trainMarker = new maplibregl.Marker({ element, anchor: 'center' })
                    .setLngLat([position.lng, position.lat])
                    .addTo(map);

                trainMarker.customLineType = "EAL";

                const infoWin = new maplibregl.Popup({
                    maxWidth: '1000px',
                    offset: [0, -15],
                    closeButton: true,
                    className: 'custom-popup'
                });

                setupInfoWindowClose(infoWin);

                element.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (openedWindow) openedWindow.remove();

                    infoWin.setHTML(getHtmlContent());
                    infoWin.setLngLat([position.lng, position.lat]).addTo(map);
                    infoWin.associatedMarker = trainMarker;
                    openedWindow = infoWin;

                    allMarkers.forEach(m => { if(m.getElement()) m.getElement().style.zIndex = m.getElement().originalZIndex || 100; });
                    element.style.zIndex = 9999;
                });

                allMarkers.push(trainMarker);
                trainMarkers[trainId] = trainMarker;
                i++;
            }
        } catch (e) {
            console.error("EAL Train update error:", e);
        }
    }
}

async function updateTMLTrainLocations(data) {
    let i = 0;
    for (const train of data.Items) {
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));

        try {
            const position = getTrainAt(train, "TML");
            if (!position) continue;

            const { trainId, trainSpeed, listCars, currentStationCode: csc, nextStationCode: nsc, destinationStationCode: dsc, receivedTime, train_type } = train;
            const isUp = convertTMLStationOrder(csc) > convertTMLStationOrder(dsc);

            const getHtmlContent = () => {
                const currentStationCode = tmlStationMap[csc] || nsc;
                const nextStationCode = tmlStationMap[nsc] || nsc;
                const destinationStationCode = tmlStationMap[dsc] || nsc;

                return `<div class="train-info-container">
                    <div class="train-info-title font-bold text-center flex-center">${trainId} ${currentStationCode} to ${nextStationCode} (${destinationStationCode}) ${trainSpeed}km/h</div>
                    <div class="train-info-cars-wrapper flex-center"><div class="train-info-direction">&#x25C0;</div>
                    ${(!isUp ? listCars : [...listCars].reverse()).map(car => {
                    const bg = car.passengerCount < 110 ? '#4CAF50' : car.passengerCount < 250 ? '#CDDC39' : '#F44336';
                    return `<div class="train-info-car flex-center text-white" style="background-color: ${bg};">${car.passengerCount ?? '-'}</div>`;
                }).join('')}</div></div>`;
            };

            const isNis = csc === 0 || Date.now() / 1000 - receivedTime > 60;
            const prefix = train_type === "SP1900" ? "sp1900" : "t1141a";
            const newSrc = `public/${prefix}_${isNis ? 'unknown' : (isUp ? 'dn' : 'up')}.png`;

            if (trainMarkers[trainId]) {
                trainMarkers[trainId].setLngLat([position.lng, position.lat]);
                trainMarkers[trainId].getElement().style.display = currentVisibility.trains.TML ? 'block' : 'none';

                const imgElement = trainMarkers[trainId].getElement().querySelector('img');
                if (!imgElement.src.includes(newSrc)) imgElement.src = newSrc;
                if (isNis && csc === 0) imgElement.classList.add('opacity-50');
                else imgElement.classList.remove('opacity-50');

                if (openedWindow?.associatedMarker === trainMarkers[trainId]) {
                    openedWindow.setHTML(getHtmlContent());
                }
            } else {
                const element = document.createElement("div");
                element.className = "tml-train-marker-wrapper";
                element.innerHTML = `<img src="${newSrc}" class="marker-icon train-marker-icon ${isNis && csc === 0 ? 'opacity-50' : ''}">`;
                element.style.display = currentVisibility.trains.TML ? 'block' : 'none';

                handleMarkerInteractions(element, 300 + i);

                const trainMarker = new maplibregl.Marker({ element, anchor: 'center' })
                    .setLngLat([position.lng, position.lat])
                    .addTo(map);

                trainMarker.customLineType = "TML";

                const infoWin = new maplibregl.Popup({
                    maxWidth: '1000px',
                    offset: [0, -15],
                    closeButton: true,
                    className: 'custom-popup'
                });

                setupInfoWindowClose(infoWin);

                element.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (openedWindow) openedWindow.remove();

                    infoWin.setHTML(getHtmlContent());
                    infoWin.setLngLat([position.lng, position.lat]).addTo(map);
                    infoWin.associatedMarker = trainMarker;
                    openedWindow = infoWin;

                    allMarkers.forEach(m => { if(m.getElement()) m.getElement().style.zIndex = m.getElement().originalZIndex || 100; });
                    element.style.zIndex = 9999;
                });

                allMarkers.push(trainMarker);
                trainMarkers[trainId] = trainMarker;
                i++;
            }
        } catch (e) {}
    }
}