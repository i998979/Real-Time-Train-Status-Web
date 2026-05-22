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

let apiUrl;

// On page load
window.addEventListener("DOMContentLoaded", async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const today = new Date();
    const migrationDate = new Date('2026-05-31');
    if (urlParams.get('migrated') === 'true' && today <= migrationDate) {
        const banner = document.getElementById("migration-banner");
        banner.style.display = 'block';
    }

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
        eal_main,
        eal_low,
        eal_lmc,
        eal_rac,
        tml_main,
        ktl_main,
        ael_main,
        drl_main,
        isl_main,
        tcl_main,
        tkl_main,
        tkl_lhp,
        twl_main,
        sil_main
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

// Add event listener for visibility change
document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
        console.log("Tab is active. Starting fetch interval.");

        if (!trainInterval) {
            await fetchTrainData();
            trainInterval = setInterval(fetchTrainData, 5000);
        }
        if (openedWindow) {
            clearInterval(stationInterval);

            await fetchNextTrain(openedStation);
            await fetchRoctec(openedStation);
            stationInterval = setInterval(() => {
                fetchNextTrain(openedStation);
                fetchRoctec(openedStation);
            }, 5000);
        }
    }
    // Cancel any ongoing train fetch and schedule
    else {
        console.log("Tab is inactive. Clearing fetch interval and aborting fetch.");

        [trainInterval, stationInterval, hkoInterval].forEach(i => {
            return i && clearInterval(i);
        });
        [trainController, rtController, ntController, hkoController].forEach(c => {
            return c && c.abort();
        });
        trainInterval = stationInterval = hkoInterval = null;
        trainController = rtController = ntController = hkoController = null;
    }
});

let map, spherical, AdvancedMarkerElement;
let ealData, tmlData, ktlData, islData, twlData, tklData, tclData;
let weatherIcons = [], temperature = null;

// Initialize the map
async function initMap() {
    const {Map} = await google.maps.importLibrary("maps");
    spherical = (await google.maps.importLibrary("geometry")).spherical;
    AdvancedMarkerElement = (await google.maps.importLibrary("marker")).AdvancedMarkerElement;

    let center = stationLoc["HTD"];
    let zoom = 12;

    const savedView = localStorage.getItem("last_map_view");
    if (savedView) {
        try {
            const parsed = JSON.parse(savedView);
            center = {lat: parsed.lat, lng: parsed.lng};
            zoom = parsed.zoom;
        } catch (e) {
        }
    }

    map = new Map(document.getElementById("map"), {
        center: center,
        zoom: zoom,
        mapId: '7588c4bd46aa102a',
        streetViewControl: false,
        clickableIcons: false,
    });

    map.addListener("click", () => {
        if (openedWindow) {
            openedWindow.close();

            if (stationInterval) clearInterval(stationInterval);
            if (rtController) rtController.abort();
            if (ntController) ntController.abort();

            if (openedWindow.associatedMarker) {
                openedWindow.associatedMarker = null;
            }
            openedWindow = null;
            openedStation = null;
            stationInterval = null;
            rtController = null;
            ntController = null;

            roctecTrainData = ntTrainData = [];
            roctecLastUpdate = ntLastUpdate = "Never";
        }
    });

    map.addListener("idle", () => {
        const center = map.getCenter();
        const settings = {
            lat: center.lat(),
            lng: center.lng(),
            zoom: map.getZoom()
        };
        localStorage.setItem("last_map_view", JSON.stringify(settings));
    });

    await drawLines();
    await drawStations();

    // Start fetching train data if not scheduled
    if (!trainInterval) {
        await fetchTrainData();
        trainInterval = setInterval(fetchTrainData, 5000);
    }

    await fetchHKOData();
    hkoInterval = setInterval(fetchHKOData, 60000);
}

// Fetch train location from callback
async function fetchTrainData() {
    try {
        if (trainController) trainController.abort();

        trainController = new AbortController();
        const {signal} = trainController;
        const lineNames = ["EAL", "TML", "KTL", "ISL", "TWL", "TKL", "TCL"];

        [ealData, tmlData, ktlData, islData, twlData, tklData, tclData] = await Promise.all(lineNames.map(line =>
            fetch(`${apiUrl}line=${line}`, {signal})
                .then(res => {
                    return res.ok ? res.json() : Promise.reject(`${line} fetch failed`);
                })
        ));

        // Update train locations
        await Promise.all([
            updateEALTrainLocations(ealData),
            updateTMLTrainLocations(tmlData)
        ]);
    } catch (e) {
        if (e.name !== "AbortError")
            console.error("Train data fetch error:", e);
    } finally {
        trainController = null;
    }
}

// Fetch Roctec data from API
async function fetchRoctec(station) {
    try {
        if (rtController) rtController.abort();

        rtController = new AbortController();

        const response = await fetch(`${apiUrl}station=${station}`, {signal: rtController.signal});
        if (response.ok) {
            await updateStationData(station, await response.json(), "Roctec");
        }
    } catch (e) {
        if (e.name !== "AbortError")
            console.error("Error fetching station data:", e);
    } finally {
        rtController = null;
    }
}

// Fetch NextTrain data from API
async function fetchNextTrain(station) {
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
        if (e.name !== "AbortError")
            console.error("Error fetching NextTrain:", e);
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
        if (e.name !== "AbortError")
            console.error("Error fetching HKO:", e);
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
                        const data = {
                            KTL: ktlData,
                            ISL: islData,
                            TWL: twlData,
                            TKL: tklData,
                            TCL: tclData
                        }[line];
                        const match = data?.find(t => {
                            const ttd = (t.td || "").trim();
                            const tNum = parseInt(ttd.slice(line === "TCL" ? -3 : -2), 10);
                            if (Date.now() / 1000 - t.updatedTime > (line === "TCL" ? 600 : 300)) return false;
                            return ttd === td || ttd.endsWith(td) || (tNum === tdNum && !isNaN(tNum));
                        });
                        train0 = match ? (line === "TKL" ? match.trainId : match.trainConsist) : "-";
                    }
                    roctecTrainData.push({
                        line,
                        plat,
                        destination: trip.destination,
                        trip: trip.td,
                        train: train0,
                        ttnt: trip.ttnt
                    });
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
                    line,
                    plat: trip.plat,
                    destination: trip.dest,
                    ttnt: trip.ttnt
                }));
            });
        }
    }

    if (openedWindow && stationMarkers[station] === openedWindow.associatedMarker) {
        const renderTable = (isRoctec) => {
            let content = `
                        <div style="font-family: Arial, sans-serif; font-size: 24px; width: 550px;">
                            <div style="font-size: 32px; font-weight: bold; text-align: center;">${stations[station.toLowerCase()]}</div>
                            <div style="text-align: right; color: gray;">Last Update: ${isRoctec ? new Date(roctecLastUpdate).toLocaleString("zh-HK", {timeZone: "Asia/Hong_Kong"}) : ntLastUpdate}</div>
                            <div style="text-align: left; margin-top: 5px; background-color: #02254D; padding: 5px;">
                                ${weatherIcons.map(icon => `<img src="public/${icon}" alt="" style="height: 32px; vertical-align: middle; margin-right: 4px;">`).join('')}
                                <span style="font-size: 20px; vertical-align: middle; color: white;">${temperature}°C</span>
                            </div>
                            <table style="width: 100%; border-collapse: collapse;">
                                <thead>
                                    <tr style="background-color: #02254D; color: white;">
                                        <th style="text-align: left; border: 1px solid #ddd; padding: 5px;">Destination</th>
                                        ${isRoctec ? '<th style="text-align: left; border: 1px solid #ddd; padding: 5px;">Trip</th><th style="text-align: left; border: 1px solid #ddd; padding: 5px;">Train</th>' : ''}
                                        <th style="text-align: left; border: 1px solid #ddd; padding: 5px;">Plat.</th>
                                        <th style="text-align: left; border: 1px solid #ddd; padding: 5px;">TTNT</th>
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
                                    <td colspan="${isRoctec ? 5 : 3}" style="background-color: ${lines[train.line.toLowerCase()].color}; color: white; font-weight: bold; padding: 5px; border: 1px solid #ddd;">
                                        ${lines[train.line.toLowerCase()].name}
                                    </td>
                                </tr>`;
                    currentLine = train.line;
                    currentColor = '#FFFFFF';
                }
                const destText = stations[train.destination.toLowerCase()] ?? train.destination;
                let destHtml = `
                            <td style="border: 1px solid #ddd; padding: 5px;">
                                ${destText}
                            </td>`;

                if (isRoctec && (train.line === "EAL" || train.line === "NSL")) {
                    const isRace = /[BGKN]/.test(train.trip);
                    destHtml = `
                                <td style="border: 1px solid #ddd; padding: 5px; max-width: 150px; overflow: hidden;">
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
                                ${isRoctec ? `
                                    <td style="border: 1px solid #ddd; padding: 5px;">${train.trip}</td>
                                    <td style="border: 1px solid #ddd; padding: 5px;">${train.train}</td>
                                ` : ''}
                                <td style="border: 1px solid #ddd; padding: 5px;">${train.plat}</td>
                                <td style="border: 1px solid #ddd; padding: 5px;">${train.ttnt}</td>
                            </tr>`;

                currentColor = currentColor === '#FFFFFF' ? '#C5D9E4' : '#FFFFFF';
            });

            content += `
                                </tbody>
                            </table>
                            <div style="text-align: center; margin-top: 10px;">
                                <button id="toggleBtn" style="color: black; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 18px;">${isRoctec ? 'NEXT TRAIN' : 'ROCTEC'}</button>
                            </div>
                        </div>
                    `;

            openedWindow.setContent(content);
            const btn = document.getElementById('toggleBtn');
            btn.onclick = () => {
                openedType = isRoctec ? "NextTrain" : "Roctec";
                renderTable(!isRoctec);
            };

            if (isRoctec) {
                document.querySelectorAll('.marquee-container').forEach(c => {
                    const t = c.querySelector('.marquee-text');
                    if (t && t.scrollWidth > c.clientWidth)
                        t.classList.add('marquee-animate');
                });
            }
        };

        requestAnimationFrame(() => {
            google.maps.event.addListenerOnce(openedWindow, 'domready', () => {
                renderTable(openedType === "Roctec");
            });
        });

        if (openedType === type) renderTable(type === "Roctec");
    }
}

async function drawLines() {
    [
        {path: eal_main, name: 'eal'}, {path: eal_rac, name: 'eal'}, {path: eal_low, name: 'eal'},
        {path: eal_lmc, name: 'eal'}, {path: tml_main, name: 'tml'}, {path: ktl_main, name: 'ktl'},
        {path: ael_main, name: 'ael'}, {path: drl_main, name: 'drl'}, {path: isl_main, name: 'isl'},
        {path: tcl_main, name: 'tcl'}, {path: tkl_main, name: 'tkl'}, {path: tkl_lhp, name: 'tkl'},
        {path: twl_main, name: 'twl'}, {path: sil_main, name: 'sil'}
    ].forEach(({path, name}) => {
        new google.maps.Polyline({
            path,
            geodesic: false,
            strokeColor: lines[name].color,
            strokeOpacity: 1.0,
            strokeWeight: 5
        }).setMap(map);
    });
}

// allMarkers for reordering zIndex
let allMarkers = [];

async function drawStations() {
    const entries = Object.entries(stationLoc);
    for (let i = 0; i < entries.length; i++) {
        if ((i >= 16 && i <= 26) || i === 52) continue;

        const [station, location] = entries[i];
        const element = Object.assign(document.createElement("div"), {
            innerHTML: `<img src="public/${i <= 52 ? "station" : "mtr"}.png" alt="Station" style="width: 100px; height: 100px">`,
            style: "position:absolute; transform: translate(-50%, -50%)"
        });

        const stationMarker = new AdvancedMarkerElement({
            position: location,
            map,
            content: element,
            gmpClickable: true,
            zIndex: 100 + i
        });
        stationMarkers[station] = stationMarker;
        allMarkers.push(stationMarker);

        // Create the InfoWindow
        const infoWindow = new google.maps.InfoWindow({
            content: `
                        <div style="font-family: Arial, sans-serif; font-size: 24px; width: 550px;">
                            <div style="font-size: 32px; font-weight: bold; text-align: center;">
                                ${stations[station.toLowerCase()]}
                            </div>
                        </div>
                    `,
            maxWidth: 1000,
            pixelOffset: new google.maps.Size(0, -50)
        });

        stationMarker.addListener('gmp-click', () => {
            // Close window if there is an opened one
            if (openedWindow) {
                openedWindow.close();
                openedWindow = null;
            }

            // Abort previous fetch and fetch schedule
            [stationInterval].forEach(i => i && clearInterval(i));
            [rtController, ntController].forEach(c => c && c.abort());

            // Return if user clicked already opened marker
            if (station === openedStation) {
                openedStation = null;
                infoWindow.associatedMarker = null;
                return;
            }

            // Clear data if opened station isn't marker station
            if (station !== openedStation) {
                roctecTrainData = ntTrainData = [];
                roctecLastUpdate = ntLastUpdate = "Never";
            } else {
                updateStationData(station, roctecTrainData, "Roctec");
                updateStationData(station, ntTrainData, "NextTrain");
            }

            infoWindow.associatedMarker = stationMarker;
            openedStation = station;
            openedWindow = infoWindow;

            // Open new window
            infoWindow.open({
                anchor: stationMarker,
                map,
                shouldFocus: false
            });

            // Fetch station data
            fetchNextTrain(station);
            fetchRoctec(station);
            // Reschedule schedule fetch
            stationInterval = setInterval(() => {
                fetchNextTrain(station);
                fetchRoctec(station);
            }, 5000);

            allMarkers.forEach(m => {
                if (m.zIndex <= stationMarker.zIndex) m.zIndex++;
                if (m.zIndex === 0) m.zIndex = stationMarker.zIndex;
            });
            stationMarker.zIndex = 0;

            // Clear open status on close
            infoWindow.addListener('closeclick', () => {
                if (stationInterval) clearInterval(stationInterval);
                if (rtController) rtController.abort();
                if (ntController) ntController.abort();
                infoWindow.associatedMarker = openedStation = openedWindow = stationInterval = rtController = ntController = null;
                roctecTrainData = ntTrainData = [];
                roctecLastUpdate = ntLastUpdate = "Never";
            });
        });
    }
}

function convertTMLStationOrder(code) {
    const stationMap = {
        1: 16, 14: 17, 21: 9, 22: 8, 23: 7, 24: 6, 25: 5, 26: 4, 27: 3, 28: 2, 29: 1,
        41: 19, 42: 20, 43: 21, 44: 22, 45: 23, 46: 24, 47: 25, 48: 26, 49: 27, 50: 18,
        61: 15, 62: 14, 63: 13, 64: 12, 65: 11, 66: 10
    };

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
    // Retrieve all sector points
    let sectorPoints = line === "EAL" ? (isSpur ? eal_lmc : eal_low).concat(eal_main) : tml_main;

    // Closest sector
    let closestSector = [];
    // How close it is
    let closestDistance = Number.MAX_VALUE;

    // Loop through all sectors, omit the last one as it must be the ending point
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

    // If both "from" and "to" is in the same sector
    if (toSector.every(p => fromSector.includes(p))) return [from, to];

    // If they are in different sector
    // Get the starting point of from's sector, then retrieve the index of it
    let start = sectorPoints.indexOf(fromSector[1]);
    // Get the ending point of to's sector, then retrieve the index of it
    let end = sectorPoints.indexOf(toSector[0])

    let swapped = false;
    if (start > end) {
        swapped = true;
        start = sectorPoints.indexOf(toSector[1]);
        end = sectorPoints.indexOf(fromSector[0]);
    }
    let res = [swapped ? to : from];
    // Loop through all sector point between start and end
    for (let i = start; i <= end; i++) {
        res.push(sectorPoints[i]);
    }
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

    // FOT->SHT->ADM will show FOT->SHT when arrived SHT
    if (currLatLng && nextLatLng && trip.targetDistance === 0 && isPassengerTrain(trip.td))
        return null;

    // Handle non-passenger train
    if ((targetDistance === 0 && startDistance === 0) || startDistance > 10000)
        return currLatLng;

    if (startDistance > 10000)
        return currLatLng;

    if ([0, 701].includes(currentStationCode) && [0, 701].includes(nextStationCode))
        return stationLoc[line === "EAL" ? "HTD" : "PHD"];

    // Is this LMC Spur sector
    const isSpur = currentStationCode === 14 || destinationStationCode === 14 || nextStationCode === 14;

    const cacheKey = `${line}-${currentStationCode}-${nextStationCode}-${isSpur}`;

    // If this sector does not exist in cache, add to it
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

    // Get from cache
    const cachedData = trainPathCache[cacheKey];
    const lengthBetweenCurrAndNext = cachedData.totalLength * (startDistance / (targetDistance + startDistance));

    let elapsedDistance = 0;
    let segmentDistance = 0;
    let sector = [cachedData.sectors[0], cachedData.sectors[1]];

    // Find which sector the train is in
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

            const {
                trainId,
                trainSpeed,
                listCars,
                td,
                currentStationCode: csc,
                nextStationCode: nsc,
                destinationStationCode: dsc,
                receivedTime
            } = train;

            const isUp = parseInt(td.slice(-1)) % 2 !== 0;

            const getHtmlContent = () => {
                const currentStationCode = ealStationMap[csc] || 'Unknown';
                const nextStationCode = ealStationMap[nsc] || 'Unknown';
                const destinationStationCode = ealStationMap[dsc] || 'Unknown';

                // Update marker info window content
                return `<div style="font-family: Arial, sans-serif; width: 750px; height: 80px; font-size: 24px; padding: 10px; border: 2px solid #ccc; background-color: white;">
                    <div style="font-weight: bold; font-size: 28px; margin-bottom: 10px; display: flex; justify-content: center; align-items: center;">
                        ${trainId} (T${Math.floor(trainId / 3)}) ${td} ${currentStationCode} to ${nextStationCode} (${destinationStationCode}) ${trainSpeed}km/h
                    </div><div style="display: flex; justify-content: center; align-items: center; gap: 4px;">
                        <div style="color: gray; font-size: 24px;">&#x25C0;</div>
                        ${(isUp ? listCars : [...listCars].reverse()).map((car, idx) => {
                    const isFirstCl = (isUp && idx === 3) || (!isUp && idx === 5);
                    const bg = car.passengerCount < (isFirstCl ? 70 : 110) ? '#4CAF50' : car.passengerCount < (isFirstCl ? 150 : 250) ? '#CDDC39' : '#F44336';
                    return `<div style="background-color: ${bg}; color: ${isFirstCl ? '#880015' : 'white'}; display: flex; justify-content: center; align-items: center; width: 40px; height: 28px; padding: 4px 10px; border-radius: 6px;">${car.passengerCount}</div>`;
                }).join('')}
                    </div></div>`;
            };

            if (trainMarkers[trainId]) {
                // Update existing marker position
                trainMarkers[trainId].position = position;

                const isNis = csc === 0 || Date.now() / 1000 - receivedTime > 60 || !isPassengerTrain(td);
                const imgElement = trainMarkers[trainId].content.querySelector('img');
                const newSrc = `public/r_train_${isNis ? 'unknown' : (isUp ? 'up' : 'dn')}.png`;
                if (!imgElement.src.includes(newSrc))
                    imgElement.src = newSrc;
                imgElement.style.opacity = (isNis && csc === 0) ? '0.5' : '1';

                // If the info window for this marker is open, update its content
                if (openedWindow?.associatedMarker === trainMarkers[trainId])
                    openedWindow.setContent(getHtmlContent());
            } else {
                const element = document.createElement("div");
                const isNis = csc === 0 || Date.now() / 1000 - receivedTime > 60 || !isPassengerTrain(td);
                element.innerHTML = `<img src="public/r_train_${isNis ? 'unknown' : (isUp ? 'up' : 'dn')}.png" style="width: 100px; height: 100px; display: block; margin: 0 auto; ${isNis && csc === 0 ? 'opacity: 0.5;' : ''}">`;

                const trainMarker = new AdvancedMarkerElement({
                    position,
                    map,
                    content: element,
                    gmpClickable: true,
                    zIndex: i
                });

                // Create the InfoWindow
                const infoWin = new google.maps.InfoWindow({
                    maxWidth: 1000,
                    pixelOffset: new google.maps.Size(0, 50)
                });

                // Attach a click event listener using native DOM methods
                trainMarker.addListener('gmp-click', () => {
                    if (openedWindow)
                        openedWindow.close();

                    infoWin.setContent(getHtmlContent());
                    infoWin.open(map, trainMarker);
                    infoWin.associatedMarker = trainMarker;
                    openedWindow = infoWin;

                    allMarkers.forEach(m => {
                        if (m.zIndex <= trainMarker.zIndex)
                            m.zIndex++;
                        if (m.zIndex === 0)
                            m.zIndex = trainMarker.zIndex;
                    });
                    trainMarker.zIndex = 0;
                });

                // Store the marker
                allMarkers.push(trainMarker);
                trainMarkers[trainId] = trainMarker;
                i++;
            }
        } catch (e) {
            console.error("Train data fetch error:", e);
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

            const {
                trainId,
                trainSpeed,
                listCars,
                currentStationCode: csc,
                nextStationCode: nsc,
                destinationStationCode: dsc,
                isInService,
                receivedTime,
                train_type
            } = train;

            const isUp = convertTMLStationOrder(csc) > convertTMLStationOrder(dsc);

            const getHtmlContent = () => {
                const currentStationCode = tmlStationMap[csc] || nsc;
                const nextStationCode = tmlStationMap[nsc] || nsc;
                const destinationStationCode = tmlStationMap[dsc] || nsc;

                return `<div style="font-family: Arial, sans-serif; width: 750px; height: 80px; font-size: 24px; padding: 10px; border: 2px solid #ccc; background-color: white;">
                    <div style="font-weight: bold; font-size: 28px; margin-bottom: 10px; display: flex; justify-content: center; align-items: center;">
                        ${trainId} ${currentStationCode} to ${nextStationCode} (${destinationStationCode}) ${trainSpeed}km/h
                    </div><div style="display: flex; justify-content: center; align-items: center; gap: 4px;">
                        <div style="color: gray; font-size: 24px;">&#x25C0;</div>
                        ${(!isUp ? listCars : [...listCars].reverse()).map(car => {
                    const bg = car.passengerCount < 110 ? '#4CAF50' : car.passengerCount < 250 ? '#CDDC39' : '#F44336';
                    return `<div style="background-color: ${bg}; color: white; display: flex; justify-content: center; align-items: center; width: 40px; height: 28px; padding: 4px 10px; border-radius: 6px;">${car.passengerCount ?? '-'}</div>`;
                }).join('')}
                    </div></div>`;
            };

            if (trainMarkers[trainId]) {
                // Update existing marker position
                trainMarkers[trainId].position = position;

                const isNis = csc === 0 || Date.now() / 1000 - receivedTime > 60;
                const prefix = train_type === "SP1900" ? "sp1900" : "t1141a";
                const imgElement = trainMarkers[trainId].content.querySelector('img');
                const newSrc = `public/${prefix}_${isNis ? 'unknown' : (isUp ? 'dn' : 'up')}.png`;
                if (!imgElement.src.includes(newSrc))
                    imgElement.src = newSrc;

                imgElement.style.opacity = (isNis && csc === 0) ? '0.5' : '1';

                // If the info window for this marker is open, update its content
                if (openedWindow?.associatedMarker === trainMarkers[trainId]) {
                    openedWindow.setContent(getHtmlContent());
                }
            } else {
                const element = document.createElement("div");
                element.style.willChange = "transform, opacity";
                element.style.transform = "translateZ(0)";
                const isNis = csc === 0 || Date.now() / 1000 - receivedTime > 60;
                const prefix = train_type === "SP1900" ? "sp1900" : "t1141a";
                element.innerHTML = `<img src="public/${prefix}_${isNis ? 'unknown' : (isUp ? 'dn' : 'up')}.png" style="width: 100px; height: 100px; display: block; margin: 0 auto; ${isNis && csc === 0 ? 'opacity: 0.5;' : ''}">`;

                const trainMarker = new AdvancedMarkerElement({
                    position,
                    map,
                    content: element,
                    gmpClickable: true,
                    zIndex: 36 + i
                });

                // Create the InfoWindow
                const infoWin = new google.maps.InfoWindow({
                    maxWidth: 1000,
                    pixelOffset: new google.maps.Size(0, 50)
                });

                // Attach a click event listener using native DOM methods
                trainMarker.addListener('gmp-click', () => {
                    if (openedWindow)
                        openedWindow.close();

                    infoWin.setContent(getHtmlContent());
                    infoWin.open(map, trainMarker);
                    infoWin.associatedMarker = trainMarker;
                    openedWindow = infoWin;

                    allMarkers.forEach(m => {
                        if (m.zIndex <= trainMarker.zIndex)
                            m.zIndex++;
                        if (m.zIndex === 0)
                            m.zIndex = trainMarker.zIndex;
                    });
                    trainMarker.zIndex = 0;
                });

                // Store the marker
                allMarkers.push(trainMarker);
                trainMarkers[trainId] = trainMarker;
                i++;
            }
        } catch (e) {
        }
    }
}