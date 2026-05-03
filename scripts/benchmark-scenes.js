import yargs from 'yargs';
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';
import { PNG } from 'pngjs';
import { exec } from 'child_process';

const excludeList = [
	'khronos-MetalRoughSpheres-LDR',
	'khronos-BoxInterleaved',
];

const GOLDEN_BASE_URL = 'https://media.githubusercontent.com/media/KhronosGroup/glTF-Render-Fidelity-Generator/refs/heads/main/test/goldens';

const argv = yargs( process.argv.slice( 2 ) )
	.usage( 'Usage: $0 <command> [options]' )
	.option( 'output-path', {
		describe: 'Output directory for benchmark results and images.',
		alias: 'o',
		type: 'string',
		default: './benchmark/',
	} )
	.option( 'golden-path', {
		describe: 'Path to local golden images directory. If not provided, downloads from Khronos repo.',
		alias: 'g',
		type: 'string',
	} )
	.option( 'scenario', {
		describe: 'Comma-separated list of scenarios to run. If not provided, runs all.',
		alias: 's',
		type: 'string',
	} )
	.option( 'samples', {
		describe: 'Comma-separated list of sample counts to test.',
		alias: 'n',
		type: 'string',
		default: '16,32,64,128',
	} )
	.option( 'headless', {
		describe: 'Whether to run in headless mode.',
		alias: 'h',
		type: 'boolean',
		default: false,
	} )
	.option( 'save-images', {
		describe: 'Whether to save rendered images.',
		type: 'boolean',
		default: true,
	} )
	.option( 'save-golden', {
		describe: 'Whether to save downloaded golden images locally.',
		type: 'boolean',
		default: true,
	} )
	.option( 'tiles', {
		describe: 'Number of tiles to use for rendering.',
		type: 'number',
		default: 4,
	} )
	.option( 'scale', {
		describe: 'Render scale.',
		type: 'number',
		default: 1,
	} )
	.option( 'is-webgpu', {
		describe: 'Whether to use WebGPU renderer.',
		type: 'boolean',
		default: false,
	} )
	.option( 'csv', {
		describe: 'Whether to save results as CSV in addition to JSON.',
		type: 'boolean',
		default: true,
	} )
	.option( 'decimal-delimiter', {
		describe: 'Decimal delimiter for numbers in CSV output.',
		type: 'string',
		default: ',',
	} )
	.argv;

const sampleCounts = argv.samples.split( ',' ).map( s => parseInt( s.trim() ) ).filter( s => ! isNaN( s ) );

let targetScenarios = null;
if ( argv.scenario ) {

	targetScenarios = argv.scenario.split( ',' ).map( s => s.trim() );

}

function calculateMSE( imagePath1, imagePath2 ) {

	const img1 = PNG.sync.read( fs.readFileSync( imagePath1 ) );
	const img2 = PNG.sync.read( fs.readFileSync( imagePath2 ) );

	if ( img1.width !== img2.width || img1.height !== img2.height ) {

		throw new Error( `Image dimensions mismatch: ${ img1.width }x${ img1.height } vs ${ img2.width }x${ img2.height }` );

	}

	let sumSquaredError = 0;
	const numPixels = img1.width * img1.height;

	for ( let i = 0; i < img1.data.length; i += 4 ) {

		const r1 = img1.data[ i ];
		const g1 = img1.data[ i + 1 ];
		const b1 = img1.data[ i + 2 ];
		const r2 = img2.data[ i ];
		const g2 = img2.data[ i + 1 ];
		const b2 = img2.data[ i + 2 ];

		sumSquaredError += ( r1 - r2 ) ** 2;
		sumSquaredError += ( g1 - g2 ) ** 2;
		sumSquaredError += ( b1 - b2 ) ** 2;

	}

	const mse = sumSquaredError / ( numPixels * 3 );
	const rmse = Math.sqrt( mse );
	const psnr = mse === 0 ? Infinity : 20 * Math.log10( 255 / rmse );

	return { mse, rmse, psnr, width: img1.width, height: img1.height };

}

async function downloadGolden( scenarioName, targetPath ) {

	const goldenUrl = `${ GOLDEN_BASE_URL }/${ scenarioName }/dspbr-pt-golden.png`;
	const response = await fetch( goldenUrl );
	if ( ! response.ok ) {

		throw new Error( `Failed to download golden image for ${ scenarioName }: ${ response.status } ${ response.statusText }` );

	}

	const buffer = await response.buffer();
	fs.mkdirSync( path.dirname( targetPath ), { recursive: true } );
	fs.writeFileSync( targetPath, buffer );

}

async function getGoldenPath( scenarioName, goldenFolder ) {

	// Check local golden path first
	if ( argv[ 'golden-path' ] ) {

		const localPath = path.resolve( argv[ 'golden-path' ], `${ scenarioName }.png` );
		if ( fs.existsSync( localPath ) ) {

			return localPath;

		}

	}

	// Use downloaded golden folder
	const downloadedPath = path.resolve( goldenFolder, `${ scenarioName }.png` );
	if ( fs.existsSync( downloadedPath ) ) {

		return downloadedPath;

	}

	await downloadGolden( scenarioName, downloadedPath );
	return downloadedPath;

}

async function runScenario( browser, scenario, sampleCount, imageFolder ) {

	const name = scenario.name;
	const page = await browser.newPage();

	try {

		const url = `http://localhost:5173/viewerTest.html?hideUI=true&scale=${ argv.scale }&tiles=${ argv.tiles }&samples=${ sampleCount }&isWebGPU=${ argv[ 'is-webgpu' ] }#${ name }`;
		await page.goto( url );

		// Wait for render complete and extract accurate render time
		const eventDetail = await page.evaluate( () => {

			return new Promise( ( resolve, reject ) => {

				const TIMEOUT = 240000;
				const handle = setTimeout( () => {

					reject( new Error( `Failed to render in ${ ( 1e-3 * TIMEOUT ).toFixed( 2 ) }s.` ) );

				}, TIMEOUT );

				self.addEventListener( 'render-complete', e => {

					clearTimeout( handle );
					resolve( e.detail );

				}, { once: true } );

			} );

		} );

		const renderTime = eventDetail && eventDetail.renderTime !== undefined ? eventDetail.renderTime : null;

		// Extract canvas image
		const dataUrl = await page.evaluate( () => {

			const canvas = document.querySelector( 'canvas' );
			return canvas.toDataURL();

		} );

		const [ info, data ] = dataUrl.split( ',' );
		const [ , ext ] = info.match( /^data:.+\/(.+);base64/ );
		const buffer = Buffer.from( data, 'base64' );

		const imageName = `${ name }_samples-${ sampleCount }.${ ext }`;
		const imagePath = path.resolve( imageFolder, imageName );
		fs.writeFileSync( imagePath, buffer );

		return { renderTime, imagePath };

	} finally {

		await page.close();

	}

}

function writeCSV( results, csvPath, decimalDelimiter = ',' ) {

	const fieldDelimiter = decimalDelimiter === ',' ? ';' : ',';

	function fmtNumber( value, digits = 4 ) {

		if ( value === null || value === undefined ) return '';
		return value.toFixed( digits ).replace( '.', decimalDelimiter );

	}

	function fmtCell( value ) {

		const str = String( value );
		if ( str.includes( fieldDelimiter ) || str.includes( '"' ) || str.includes( '\n' ) ) {

			return '"' + str.replace( /"/g, '""' ) + '"';

		}

		return str;

	}

	const headers = [ 'scenario', 'samples', 'renderTimeMs', 'scriptTimeMs', 'mse', 'rmse', 'psnrDb' ];
	const rows = results.map( r => [
		r.scenario,
		r.samples,
		r.renderTime !== null ? fmtNumber( r.renderTime, 4 ) : '',
		r.scriptTime !== null ? fmtNumber( r.scriptTime, 4 ) : '',
		r.mse !== null ? fmtNumber( r.mse, 6 ) : '',
		r.rmse !== null ? fmtNumber( r.rmse, 6 ) : '',
		r.psnr !== null && r.psnr !== Infinity ? fmtNumber( r.psnr, 4 ) : ( r.psnr === Infinity ? 'Inf' : '' ),
	] );

	const csv = [ headers.join( fieldDelimiter ), ...rows.map( row => row.map( fmtCell ).join( fieldDelimiter ) ) ].join( '\n' );
	fs.writeFileSync( csvPath, csv );

}

( async () => {

	// Fetch scenarios
	const req = await fetch( 'https://raw.githubusercontent.com/KhronosGroup/glTF-Render-Fidelity-Generator/refs/heads/main/test/config.json' );
	const { scenarios } = await req.json();

	const outputPath = path.resolve( process.cwd(), argv[ 'output-path' ] );
	const imageFolder = path.resolve( outputPath, 'images' );
	const goldenFolder = path.resolve( outputPath, 'goldens' );
	const resultsPath = path.resolve( outputPath, 'results.json' );
	const csvPath = path.resolve( outputPath, 'results.csv' );

	console.log( `Saving results to "${ outputPath }"\n` );

	fs.mkdirSync( imageFolder, { recursive: true } );
	fs.mkdirSync( goldenFolder, { recursive: true } );

	console.log( 'Running test page service' );
	exec( 'npm run start' );

	// Filter scenarios
	let scenariosToRun = scenarios;
	if ( targetScenarios ) {

		scenariosToRun = scenarios.filter( s => targetScenarios.includes( s.name ) );
		const notFound = targetScenarios.filter( name => ! scenarios.find( s => s.name === name ) );
		if ( notFound.length > 0 ) {

			console.error( `Scenarios not found: ${ notFound.join( ', ' ) }` );

		}

	}

	// Launch browser
	const args = argv.headless ? [ '--use-gl=egl', '--headless' ] : [];
	const browser = await puppeteer.launch( {

		defaultViewport: null,
		args,
		headless: argv.headless,

	} );

	const results = [];

	try {

		for ( const scenario of scenariosToRun ) {

			if ( excludeList.includes( scenario.name ) ) {

				console.log( `Skipping ${ scenario.name }` );
				continue;

			}

			console.log( `\nScenario: ${ scenario.name }` );

			// Get golden image
			let goldenPath;
			try {

				goldenPath = await getGoldenPath( scenario.name, goldenFolder );

			} catch ( e ) {

				console.error( `\tFailed to get golden image: ${ e.message }` );
				continue;

			}

			for ( const sampleCount of sampleCounts ) {

				console.log( `\tSamples: ${ sampleCount }` );

				const scriptStart = Date.now();

				let runResult;
				try {

					runResult = await runScenario( browser, scenario, sampleCount, imageFolder );

				} catch ( e ) {

					console.error( `\t\tError: ${ e.message }` );
					continue;

				}

				const scriptTime = Date.now() - scriptStart;

				// Calculate MSE
				let mseResult = null;
				try {

					mseResult = calculateMSE( runResult.imagePath, goldenPath );

				} catch ( e ) {

					console.error( `\t\tMSE calculation failed: ${ e.message }` );

				}

				const result = {
					scenario: scenario.name,
					samples: sampleCount,
					renderTime: runResult.renderTime,
					scriptTime,
					mse: mseResult?.mse ?? null,
					rmse: mseResult?.rmse ?? null,
					psnr: mseResult?.psnr ?? null,
					imagePath: argv[ 'save-images' ] ? path.relative( outputPath, runResult.imagePath ) : null,
				};

				results.push( result );

				if ( mseResult ) {

					console.log( `\t\tRender time: ${ runResult.renderTime !== null ? runResult.renderTime.toFixed( 2 ) + 'ms' : 'N/A' }` );
					console.log( `\t\tMSE: ${ mseResult.mse.toFixed( 4 ) }, RMSE: ${ mseResult.rmse.toFixed( 4 ) }, PSNR: ${ mseResult.psnr === Infinity ? 'Inf' : mseResult.psnr.toFixed( 2 ) + 'dB' }` );

				}

			}

		}

		// Save results
		fs.writeFileSync( resultsPath, JSON.stringify( results, null, 2 ) );
		if ( argv.csv ) {

			writeCSV( results, csvPath, argv[ 'decimal-delimiter' ] );

		}

		// Print summary
		console.log( '\n\n=== BENCHMARK SUMMARY ===' );
		console.log( `Total runs: ${ results.length }` );
		console.log( `Results saved to: ${ resultsPath }` );
		if ( argv.csv ) {

			console.log( `CSV saved to: ${ csvPath }` );

		}

		// Print table per scenario
		const byScenario = {};
		for ( const r of results ) {

			if ( ! byScenario[ r.scenario ] ) byScenario[ r.scenario ] = [];
			byScenario[ r.scenario ].push( r );

		}

		for ( const [ scenarioName, scenarioResults ] of Object.entries( byScenario ) ) {

			console.log( `\n${ scenarioName }:` );
			console.log( '  Samples | Render Time (ms) | MSE      | PSNR (dB)' );
			console.log( '  --------|------------------|----------|----------' );
			for ( const r of scenarioResults ) {

				const rt = r.renderTime !== null ? r.renderTime.toFixed( 2 ).padStart( 16 ) : 'N/A'.padStart( 16 );
				const mse = r.mse !== null ? r.mse.toFixed( 4 ).padStart( 8 ) : 'N/A'.padStart( 8 );
				const psnr = r.psnr !== null ? ( r.psnr === Infinity ? 'Inf' : r.psnr.toFixed( 2 ) ).padStart( 9 ) : 'N/A'.padStart( 9 );
				console.log( `  ${ String( r.samples ).padStart( 7 ) } | ${ rt } | ${ mse } | ${ psnr }` );

			}

		}

	} catch ( e ) {

		console.error( e );
		process.exit( 1 );

	} finally {

		await browser.close();

	}

} )();
