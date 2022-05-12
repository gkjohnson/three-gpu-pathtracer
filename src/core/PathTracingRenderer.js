import { RGBAFormat, FloatType, Color, Vector2, WebGLRenderTarget, CustomBlending, MeshBasicMaterial } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { BlendMaterial } from '../materials/BlendMaterial.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';

function* renderTask() {

	const {
		_renderer,
		_fsQuad,
		_blendQuad,
		_primaryTarget,
		_blendTargets,
		_alpha,
		camera,
		material,
	} = this;

	let [ blendTarget1, blendTarget2 ] = _blendTargets;

	while ( true ) {

		// material.opacity = 1 / ( this.samples + 1 );
		material.seed ++;

		const w = _primaryTarget.width;
		const h = _primaryTarget.height;
		material.resolution.set( w, h );

		const tx = this.tiles.x || 1;
		const ty = this.tiles.y || 1;
		const totalTiles = tx * ty;
		const dprInv = ( 1 / _renderer.getPixelRatio() );
		for ( let y = 0; y < ty; y ++ ) {

			for ( let x = 0; x < tx; x ++ ) {

				material.cameraWorldMatrix.copy( camera.matrixWorld );
				material.invProjectionMatrix.copy( camera.projectionMatrixInverse );

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

				this.samples += ( 1 / totalTiles );

				yield;

			}

		}




		const blendMaterial = _blendQuad.material;
		blendMaterial.opacity = 1 / ( this.samples );
		blendMaterial.target1 = blendTarget1.texture;
		blendMaterial.target2 = _primaryTarget.texture;

		const ogRenderTarget = _renderer.getRenderTarget();
		_renderer.setRenderTarget( blendTarget2 );
		_blendQuad.render( _renderer );
		_renderer.setRenderTarget( ogRenderTarget );

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

		// return this._primaryTarget;
		return this._blendTargets[ 1 ];

	}

	constructor( renderer, options = {} ) {

		this.camera = null;
		this.tiles = new Vector2( 1, 1 );

		this.samples = 0;
		this.stableNoise = false;
		this._renderer = renderer;
		this._alpha = options.alpha || false;
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
