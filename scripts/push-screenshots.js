import simpleGit from 'simple-git';
import { runScript } from './utils.js';

( async() => {

	const git = simpleGit();
	const status = await git.status();
	const currentBranch = status.current;

	if ( currentBranch !== 'main' ) {

		console.error( 'Current branch is not set to main' );
		process.exit( 1 );

	}

	const modified = status.modified.length + status.created.length + status.renamed.length + status.deleted.length;
	if ( modified !== 0 ) {

		console.error( 'Current branch is not clean' );
		process.exit( 1 );

	}

	// switch and rebase branches
	console.log( 'Switching to "screenshots" branch' );
	await git.checkout( 'screenshots' );

	console.log( 'Merging in "main"' );
	await git.merge( [ 'main' ] );

	// rebuild the screenshots
	await runScript( 'node ./scripts/update-screenshots.js ' + process.argv.slice( 2 ).join( ' ' ) );

	// commit and push the screenshots
	console.log( 'Committing all screenshots.' );
	try {

		await git
			.add( './screenshots/golden/' )
			.commit( 'update screenshots' );

		console.log( 'Pushing commit.' );
		await git.push( 'origin', 'screenshots' );

	} catch ( e ) {

		console.error( 'Could not find any new files to commit' );
		console.error( e.message );

	}

	// reset git
	console.log( `Switching back to "${ currentBranch }" branch` );
	await git.checkout( currentBranch );

	process.exit();

} )();
