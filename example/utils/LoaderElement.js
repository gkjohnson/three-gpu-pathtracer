let _styleElement;
function initializeStyles() {

	if ( _styleElement ) {

		return;

	}

	_styleElement = document.createElement( 'style' );
	_styleElement.textContent = /* css */`


	`;
	document.head.appendChild( _styleElement );


}

export class LoaderElement {

	constructor() {

		initializeStyles();

		const loaderBarEl = document.createElement( 'div' );
		container.classList.add( 'bar' );

		const percentageEl = document.createElement( 'div' );
		container.classList.add( 'percentage' );

		const creditsEl = document.createElement( 'div' );
		container.classList.add( 'credits' );

		const samplesEl = document.createElement( 'div' );
		container.classList.add( 'samples' );

		const container = document.createElement( 'div' );
		container.classList.add( 'loader-container' );

		container.appendChild( loaderBarEl );
		container.appendChild( percentageEl );
		container.appendChild( samplesEl );
		container.appendChild( creditsEl );

	}

	setLoadPercent( perc ) {

	}

	setSamples( count ) {

	}

	setCredits( credits ) {

	}

}
