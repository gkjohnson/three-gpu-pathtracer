let _styleElement;
function initializeStyles() {

	if ( _styleElement ) {

		return;

	}

	_styleElement = document.createElement( 'style' );
	_styleElement.textContent = /* css */`

		.loader-container, .description {
			position: absolute;
			width: 100%;
			font-family: 'Courier New', Courier, monospace;
			color: white;
			font-weight: light;
			align-items: flex-start;
			font-size: 14px;
			pointer-events: none;
			user-select: none;
		}

		.loader-container {
			display: flex;
			flex-direction: column;
			bottom: 0;
		}

		.description {
			top: 0;
			width: 100%;
			text-align: center;
			padding: 5px 0;
		}

		.loader-container .bar {
			height: 2px;
			background: white;
			width: 100%;
		}

		.loader-container .credits,
		.loader-container .dataEl,
		.loader-container .percentage {
			padding: 5px;
			margin: 0 0 1px 1px;
			background: rgba( 0, 0, 0, 0.2 );
			border-radius: 2px;
			display: inline-block;
		}

		.loader-container:not(.loading) .bar,
		.loader-container:not(.loading) .percentage,
		.loader-container.loading .credits,
		.loader-container.loading .samples,
		.loader-container .credits:empty {
			display: none;
		}

		.loader-container .credits a,
		.loader-container .credits,
		.loader-container .dataEl {
			color: rgba( 255, 255, 255, 0.75 );
		}

		.loader-container .dataEl {
			display: flex;
			flex-direction: row;
		}
	`;
	document.head.appendChild( _styleElement );

}

export class LoaderElement {

	constructor() {

		initializeStyles();

		const container = document.createElement( 'div' );
		container.classList.add( 'loader-container' );

		const percentageEl = document.createElement( 'div' );
		percentageEl.classList.add( 'percentage' );
		container.appendChild( percentageEl );

		const dataEl = document.createElement( 'div' );
		dataEl.classList.add( 'dataEl' );
		container.appendChild( dataEl );

		const samplesEl = document.createElement( 'div' );
		samplesEl.classList.add( 'samples' );
		dataEl.appendChild( samplesEl );

		const denoisingPercentageEl = document.createElement( 'div' );
		denoisingPercentageEl.classList.add( 'denoising-percentage' );
		dataEl.appendChild( denoisingPercentageEl );

		const creditsEl = document.createElement( 'div' );
		creditsEl.classList.add( 'credits' );
		container.appendChild( creditsEl );

		const loaderBarEl = document.createElement( 'div' );
		loaderBarEl.classList.add( 'bar' );
		container.appendChild( loaderBarEl );

		const descriptionEl = document.createElement( 'div' );
		descriptionEl.classList.add( 'description' );
		container.appendChild( descriptionEl );

		this._description = descriptionEl;
		this._loaderBar = loaderBarEl;
		this._percentage = percentageEl;
		this._credits = creditsEl;
		this._data = dataEl;
		this._samples = samplesEl;
		this._denoisingPercentage = denoisingPercentageEl;
		this._container = container;

		this.setPercentage( 0 );

	}

	attach( container ) {

		container.appendChild( this._container );
		container.appendChild( this._description );

	}

	setPercentage( perc ) {

		this._loaderBar.style.width = `${ perc * 100 }%`;

		if ( perc === 0 ) {

			this._percentage.innerText = 'Loading...';

		} else {

			this._percentage.innerText = `${ ( perc * 100 ).toFixed( 0 ) }%`;

		}

		if ( perc >= 1 ) {

			this._container.classList.remove( 'loading' );

		} else {

			this._container.classList.add( 'loading' );

		}

	}

	setSamples( count, compiling = false ) {

		if ( compiling ) {

			this._samples.innerText = 'compiling shader...';

		} else {

			this._samples.innerText = `${ Math.floor( count ) } samples`;

		}

	}

	setDenoising( perc ) {

		if ( perc === 0 ) {

			this._denoisingPercentage.innerText = '';

		} else if ( perc === 1 ) {

			this._denoisingPercentage.innerText = ', denoised';

		} else {

			this._denoisingPercentage.innerText = `, ${ Math.floor( perc * 100 ) }% denoised...`;

		}

	}

	setCredits( credits ) {

		this._credits.innerHTML = credits;

	}

	setDescription( description ) {

		this._description.innerHTML = description;

	}

}
