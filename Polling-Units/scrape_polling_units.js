const puppeteer = require('puppeteer');
const fs = require('fs-extra');

const URL = 'https://cvr.inecnigeria.org/polling-unit-locator';

const delay = (ms) => new Promise(res => setTimeout(res, ms));

(async () => {
    const browser = await puppeteer.launch({
        headless: false, // 👈 IMPORTANT for debugging
        slowMo: 50,
        args: ['--no-sandbox']
    });

    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'networkidle2' });

    let results = [];

    // Wait for dropdowns to appear
    await page.waitForSelector('select');

    // DEBUG: print all select IDs
    const selectIds = await page.evaluate(() =>
        Array.from(document.querySelectorAll('select')).map(s => s.id)
    );

    console.log("Available selects:", selectIds);

    // Adjust selectors dynamically
    const stateSelector = selectIds.find(id => id.toLowerCase().includes('state'));
    const lgaSelector = selectIds.find(id => id.toLowerCase().includes('lga'));
    const wardSelector = selectIds.find(id => id.toLowerCase().includes('ward'));

    if (!stateSelector) {
        console.log("❌ Could not find state dropdown. Site structure changed.");
        await browser.close();
        return;
    }

    // Get states
    const states = await page.evaluate((selector) => {
        return Array.from(document.querySelector(`#${selector}`).options)
            .map(o => ({ value: o.value, text: o.text }))
            .filter(o => o.value);
    }, stateSelector);

    for (let state of states) {
        console.log(`Processing State: ${state.text}`);

        await page.select(`#${stateSelector}`, state.value);
        await delay(3000);

        // Wait for LGA to load
        await page.waitForFunction(
            (selector) => document.querySelector(`#${selector}`).options.length > 1,
            {},
            lgaSelector
        );

        const lgas = await page.evaluate((selector) => {
            return Array.from(document.querySelector(`#${selector}`).options)
                .map(o => ({ value: o.value, text: o.text }))
                .filter(o => o.value);
        }, lgaSelector);

        for (let lga of lgas) {
            console.log(`   LGA: ${lga.text}`);

            await page.select(`#${lgaSelector}`, lga.value);
            await delay(3000);

            await page.waitForFunction(
                (selector) => document.querySelector(`#${selector}`).options.length > 1,
                {},
                wardSelector
            );

            const wards = await page.evaluate((selector) => {
                return Array.from(document.querySelector(`#${selector}`).options)
                    .map(o => ({ value: o.value, text: o.text }))
                    .filter(o => o.value);
            }, wardSelector);

            for (let ward of wards) {
                console.log(`      Ward: ${ward.text}`);

                await page.select(`#${wardSelector}`, ward.value);
                await delay(4000);

                // Wait for table rows
                await page.waitForSelector('table tbody tr', { timeout: 5000 }).catch(() => {});

                const pollingUnits = await page.evaluate(() => {
                    const rows = document.querySelectorAll('table tbody tr');
                    return Array.from(rows).map(row => {
                        const cols = row.querySelectorAll('td');
                        return {
                            pu_code: cols[0]?.innerText.trim(),
                            pu_name: cols[1]?.innerText.trim(),
                        };
                    });
                });

                pollingUnits.forEach(pu => {
                    results.push({
                        state: state.text,
                        lga: lga.text,
                        ward: ward.text,
                        pu_code: pu.pu_code,
                        pu_name: pu.pu_name
                    });
                });

                console.log(`         Found: ${pollingUnits.length}`);
            }
        }
    }

    await fs.writeJson('polling_units.json', results, { spaces: 2 });

    console.log(`✅ DONE. Total: ${results.length}`);

    await browser.close();
})();