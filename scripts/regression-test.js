import simpleGit from 'simple-git';
import { compareImages, runScript } from './utils.js';
import yargs from 'yargs';
import path from 'path';

const DIFF_THRESHOLD = 0.1;
const PIXEL_THRESHOLD = 0.1;
const argv = yargs( process.argv.slice( 2 ) )
	.usage( 'Usage: $0 <command> [options]' )
	.option( 'diff-path', {
		describe: 'Output file for saving out an image diff.',
		alias: 'dp',
		type: 'string',
	} )
	.option( 'scenario', {
		describe: 'The name of one scenario to run.',
		alias: 's',
		type: 'string'
	} )
	.argv;

( async() => {

	if ( argv[ 'diff-path' ] && ! argv.scenario ) {

		console.error( 'Cannot save diff of multiple scenarios.' );
		process.exit( 1 );

	}

	const git = simpleGit();
	const status = await git.status();
	const currentBranch = status.current;

	const modified = status.modified.length + status.created.length + status.renamed.length + status.deleted.length;
	if ( modified !== 0 ) {

		console.error( 'Current branch is not clean' );
		process.exit( 1 );

	}

	// rebuild the screenshots
	console.log( 'Building screenshots' );
	const { scenario } = argv;
	let options = '-o ./screenshots/current/';
	if ( scenario ) {

		options += ` -s ${ scenario }`;

	}

	try {

		await runScript( `node ./scripts/update-screenshots.js ${ options }` );

	} catch {

		process.exit( 1 );

	}

	// // switch and rebase branches
	// console.log( 'Switching to "screenshots" branch' );
	// await git.checkout( 'screenshots' );

	// const rootPath = path.resolve( process.cwd(), './screenshots/' );
	// let failed = false;
	// if ( scenario ) {

	// 	console.log( `Comparing "${ scenario }" screenshots.`);
	// 	const diff = compareImages(
	// 		path.resolve( rootPath, `./golden/${ scenario }.png` ),
	// 		path.resolve( rootPath, `./current/${ scenario }.png` ),
	// 		PIXEL_THRESHOLD,
	// 		argv[ 'diff-path' ]
	// 	);

	// 	if ( diff > PIXEL_THRESHOLD ) {

	// 		failed = true;

	// 	}

	// 	console.log( `\t${ failed ? 'Fail' : 'Pass' }: Images are ${ ( 100 * diff ).toFixed( 2 ) }% different` );

	// } else {

	// 	failed = compareImages(
	// 		path.resolve( rootPath, './golden/' ),
	// 		path.resolve( rootPath, './current/' ),
	// 		PIXEL_THRESHOLD,
	// 		DIFF_THRESHOLD,
	// 	);

	// }


	// // reset git
	// console.log( `Switching back to "${ currentBranch }" branch` );
	// await git.checkout( currentBranch );

	// process.exit( failed ? 1 : 0 );

} )();
