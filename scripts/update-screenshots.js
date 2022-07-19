import yargs from 'yargs';
import puppeteer from 'puppeteer';
import path from 'path';
import url from 'url';

( async () => {

	const argv = yargs( process.argv.slice( 2 ) )
		.usage( 'Usage: $0 <command> [options]' )
		.option( 'output-path', {
			describe: 'Output directory for the files.',
			alias: 'o',
			type: 'string'
		} )
		.option( 'scenario', {
			describe: 'The name of one scenario to run.',
			alias: 's',
			type: 'string'
		} )
		.argv;

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

	await page.evaluate( () => {

		return new Promise( ( resolve, reject ) => {

			const TIMEOUT = 60000;
			const handle = setTimeout( () => {

				reject( new Error( `Failed to render in ${ TIMEOUT }ms.` ) );

			}, TIMEOUT );

			self.addEventListener( 'render-complete', () => {

				clearTimeout( handle );
				resolve();

			}, { once: true } );

		} );

	} );

	await page.screenshot( { path: `${ targetFolder }/${ name }.png`, omitBackground: true } );

	await browser.close();

}
