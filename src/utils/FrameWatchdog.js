// Calls "onStop" once a whole frame passes without a call to "markCalled"
export class FrameWatchdog {

	constructor( onStop ) {

		this.onStop = onStop;
		this._called = false;
		this._frame = null;
		this._check = () => {

			if ( ! this._called ) {

				this._frame = null;
				this.onStop();
				return;

			}

			this._called = false;
			this._frame = requestAnimationFrame( this._check );

		};

	}

	markCalled() {

		this._called = true;
		if ( this._frame === null && typeof requestAnimationFrame !== 'undefined' ) {

			this._frame = requestAnimationFrame( this._check );

		}

	}

	dispose() {

		if ( this._frame !== null ) {

			cancelAnimationFrame( this._frame );
			this._frame = null;

		}

	}

}
