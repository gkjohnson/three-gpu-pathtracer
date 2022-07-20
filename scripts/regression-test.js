import simpleGit from 'simple-git';
import { runScript } from './utils.js';

( async() => {

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
	await runScript( 'node ./scripts/update-screenshots.js -o ./screenshots/current/' );

	// switch and rebase branches
	console.log( 'Switching to "screenshots" branch' );
	await git.checkout( 'screenshots' );

	// reset git
	console.log( `Switching back to "${ currentBranch }" branch` );
	await git.checkout( currentBranch );

	process.exit();

} )();
