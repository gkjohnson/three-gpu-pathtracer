// Runs the example/benchmark.html quality and performance benchmark in a headless browser.
//
//   npm start                                   # in another terminal, serves the examples
//   node ./scripts/benchmark.js --configs bench.json --out results.json
//
// "configs" is a JSON array of `bench.run` option objects. The reference image is rendered once
// and cached in the browser profile, see "--profile".
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs( hideBin( process.argv ) )
	.option( 'url', { default: 'http://localhost:5173/benchmark.html' } )
	.option( 'configs', { type: 'string', demandOption: true } )
	.option( 'out', { type: 'string' } )
	.option( 'reference', { type: 'number', default: 4096, describe: 'reference sample count' } )
	.option( 'repeat', { type: 'number', default: 1 } )
	.option( 'atlas', { type: 'boolean', describe: 'run the texture atlas precision test' } )
	.option( 'screenshots', { type: 'string', describe: 'directory to save a canvas screenshot of every run into' } )
	.option( 'chrome', { type: 'string', default: process.env.CHROME_PATH } )
	.option( 'profile', { type: 'string', default: path.join( os.tmpdir(), 'pathtracer-benchmark-profile' ) } )
	.parse();

const configs = JSON.parse( fs.readFileSync( argv.configs, 'utf8' ) );

( async () => {

	const browser = await puppeteer.launch( {
		headless: 'new',
		executablePath: argv.chrome,
		userDataDir: argv.profile,
		protocolTimeout: 0,
		args: [ '--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1000,600' ],
	} );

	try {

		const page = await browser.newPage();
		page.on( 'console', msg => {

			if ( msg.type() === 'error' || msg.type() === 'warn' ) {

				console.error( `[page ${ msg.type() }] ${ msg.text() }` );

			}

		} );
		page.on( 'pageerror', err => console.error( `[page error] ${ err.message }` ) );

		await page.goto( argv.url, { timeout: 0 } );
		await page.evaluate( () => window.bench.ready );

		const gpu = await page.evaluate( async () => {

			const info = ( await navigator.gpu.requestAdapter() ).info;
			return `${ info.vendor } ${ info.architecture } ${ info.description }`.trim();

		} );
		console.log( `gpu: ${ gpu }` );
		console.log( 'info:', JSON.stringify( await page.evaluate( () => window.bench.info ) ) );

		if ( argv.atlas ) {

			console.log( 'atlas precision:', JSON.stringify( await page.evaluate( () => window.bench.atlasPrecision() ) ) );

		}

		const ref = await page.evaluate( spp => window.bench.reference( spp ), argv.reference );
		console.log( 'reference:', JSON.stringify( ref ) );

		const results = [];
		for ( let r = 0; r < argv.repeat; r ++ ) {

			for ( const config of configs ) {

				const result = await page.evaluate( c => window.bench.run( c ), config );
				results.push( result );

				if ( argv.screenshots ) {

					fs.mkdirSync( argv.screenshots, { recursive: true } );
					const name = `${ results.length }-${ result.label.replace( /[^a-z0-9.]+/gi, '_' ) }.png`;
					const canvas = await page.$( 'canvas' );
					await canvas.screenshot( { path: path.join( argv.screenshots, name ) } );

				}

				// the timeline is only kept in the output file
				console.log( JSON.stringify( { ...result, timeline: undefined } ) );

			}

		}

		if ( argv.out ) {

			fs.writeFileSync( argv.out, JSON.stringify( { gpu, reference: ref, results }, null, '\t' ) );

		}

	} finally {

		await browser.close();

	}

} )();
