export function getScaledSettings() {

	let frameBudget = 250000;
	let renderScale = 1;

	// adjust performance parameters for mobile
	const aspectRatio = window.innerWidth / window.innerHeight;
	if ( aspectRatio < 0.65 ) {

		frameBudget = 100000;
		renderScale = 1 / window.devicePixelRatio;

	}

	return { frameBudget, renderScale };

}
