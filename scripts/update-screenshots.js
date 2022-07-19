import yargs from 'yargs';
import puppeteer from 'puppeteer';
import path from 'path';
import url from 'url';

( async () => {

	const argv = yargs( process.argv.slice( 2 ) ).argv;

	const req = await fetch( 'https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/config.json' );
	const { models } = await req.json();
	const folderPath = path.resolve( url.fileURLToPath( import.meta.url ), './screenshots/' );

	// TODO: start the service build service with a child service

	if ( argv.scenario ) {

		if ( ! argv.scenario in models ) {

			console.error( `Scenario "${ argv.scenario }" does not exist.` );
			process.exit( 1 );

		} else {

			await saveScreenshot( argv.scenario, models[ argv.scenario ], folderPath );

		}

	} else {

		for ( const key in models ) {

			saveScreenshot( key, models[ key ], folderPath );

		}

	}

} )();

async function saveScreenshot( name, scenario, targetFolder ) {

	const browser = await puppeteer.launch( {

		defaultViewport: {
			width: scenario.dimensions.width,
			height: scenario.dimensions.height,
			deviceScaleFactor: 1
		},
		args: [ '--use-gl=egl', '--headless' ],

	} );

	const page = await browser.newPage();
	await page.goto( `https://localhost:1234/viewerTest.html?hideUI=1&tiles=1&samples=5#${ name }` );

	// TODO: await the page load and then event
	// TODO: take screenshot and save it to the target directory

	await browser.close();

}
