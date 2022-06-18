import { RGBAFormat, FloatType, Color, Vector2, WebGLRenderTarget, NoBlending, NormalBlending } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { BlendMaterial } from '../materials/BlendMaterial.js';

function* renderTask() {

	const {
		_renderer,
		_fsQuad,
		_blendQuad,
		_primaryTarget,
		_blendTargets,
		alpha,
		camera,
		material,
	} = this;

	const blendMaterial = _blendQuad.material;
	let [ blendTarget1, blendTarget2 ] = _blendTargets;

	while ( true ) {

		if ( alpha ) {

			blendMaterial.opacity = 1 / ( this.samples + 1 );
			material.blending = NoBlending;
			material.opacity = 1;

		} else {

			material.opacity = 1 / ( this.samples + 1 );
			material.blending = NormalBlending;

		}

		const w = _primaryTarget.width;
		const h = _primaryTarget.height;
		material.resolution.set( w, h );
		material.seed ++;

		const tx = this.tiles.x || 1;
		const ty = this.tiles.y || 1;
		const totalTiles = tx * ty;
		const dprInv = ( 1 / _renderer.getPixelRatio() );
		for ( let y = 0; y < ty; y ++ ) {

			for ( let x = 0; x < tx; x ++ ) {

				material.cameraWorldMatrix.copy( camera.matrixWorld );
				material.invProjectionMatrix.copy( camera.projectionMatrixInverse );

				// Perspective camera (default)
				let cameraType = 0;

				// An orthographic projection matrix will always have the bottom right element == 1
				// And a perspective projection matrix will always have the bottom right element == 0
				if ( camera.projectionMatrix.elements[ 15 ] > 0 ) {

					// Orthographic
					cameraType = 1;

				}

				if ( camera.isEquirectCamera ) {

					// Equirectangular
					cameraType = 2;

				}

				material.setDefine( 'CAMERA_TYPE', cameraType );

				const ogRenderTarget = _renderer.getRenderTarget();
				const ogAutoClear = _renderer.autoClear;

				// three.js renderer takes values relative to the current pixel ratio
				_renderer.setRenderTarget( _primaryTarget );
				_renderer.setScissorTest( true );
				_renderer.setScissor(
					dprInv * Math.ceil( x * w / tx ),
					dprInv * Math.ceil( ( ty - y - 1 ) * h / ty ),
					dprInv * Math.ceil( w / tx ),
					dprInv * Math.ceil( h / ty ) );
				_renderer.autoClear = false;
				_fsQuad.render( _renderer );

				_renderer.setScissorTest( false );
				_renderer.setRenderTarget( ogRenderTarget );
				_renderer.autoClear = ogAutoClear;

				if ( alpha ) {

					blendMaterial.target1 = blendTarget1.texture;
					blendMaterial.target2 = _primaryTarget.texture;

					_renderer.setRenderTarget( blendTarget2 );
					_blendQuad.render( _renderer );
					_renderer.setRenderTarget( ogRenderTarget );

				}

				this.samples += ( 1 / totalTiles );

				yield;

			}

		}

		[ blendTarget1, blendTarget2 ] = [ blendTarget2, blendTarget1 ];

		this.samples = Math.round( this.samples );

	}

}

const ogClearColor = new Color();
export class PathTracingRenderer {

	get material() {

		return this._fsQuad.material;

	}

	set material( v ) {

		this._fsQuad.material = v;

	}

	get target() {

		return this._alpha ? this._blendTargets[ 1 ] : this._primaryTarget;

	}

	set alpha( v ) {

		if ( ! v ) {

			this._blendTargets[ 0 ].dispose();
			this._blendTargets[ 1 ].dispose();

		}

		this._alpha = v;
		this.reset();

	}

	get alpha() {

		return this._alpha;

	}

	constructor( renderer ) {

		this.camera = null;
		this.tiles = new Vector2( 1, 1 );

		this.samples = 0;
		this.stableNoise = false;
		this._renderer = renderer;
		this._alpha = false;
		this._fsQuad = new FullScreenQuad( null );
		this._blendQuad = new FullScreenQuad( new BlendMaterial() );
		this._task = null;

		this._primaryTarget = new WebGLRenderTarget( 1, 1, {
			format: RGBAFormat,
			type: FloatType,
		} );
		this._blendTargets = [
			new WebGLRenderTarget( 1, 1, {
				format: RGBAFormat,
				type: FloatType,
			} ),
			new WebGLRenderTarget( 1, 1, {
				format: RGBAFormat,
				type: FloatType,
			} ),
		];

	}

	setSize( w, h ) {

		this._primaryTarget.setSize( w, h );
		this._blendTargets[ 0 ].setSize( w, h );
		this._blendTargets[ 1 ].setSize( w, h );
		this.reset();

	}

	dispose() {

		this._primaryTarget.dispose();
		this._blendTargets[ 0 ].dispose();
		this._blendTargets[ 1 ].dispose();

		this._fsQuad.dispose();
		this._blendQuad.dispose();
		this._task = null;

	}

	reset() {

		const { _renderer, _primaryTarget, _blendTargets } = this;
		const ogRenderTarget = _renderer.getRenderTarget();
		const ogClearAlpha = _renderer.getClearAlpha();
		_renderer.getClearColor( ogClearColor );

		_renderer.setRenderTarget( _primaryTarget );
		_renderer.setClearColor( 0, 0 );
		_renderer.clearColor();

		_renderer.setRenderTarget( _blendTargets[ 0 ] );
		_renderer.setClearColor( 0, 0 );
		_renderer.clearColor();

		_renderer.setRenderTarget( _blendTargets[ 1 ] );
		_renderer.setClearColor( 0, 0 );
		_renderer.clearColor();

		_renderer.setClearColor( ogClearColor, ogClearAlpha );
		_renderer.setRenderTarget( ogRenderTarget );

		this.samples = 0;
		this._task = null;

		if ( this.stableNoise ) {

			this.material.seed = 0;

		}

	}

	update() {

		if ( ! this._task ) {

			this._task = renderTask.call( this );

		}

		this._task.next();

	}

}
