import { RGBAFormat, FloatType, Color, Vector2, WebGLRenderTarget, NoBlending, NormalBlending, Vector4 } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { BlendMaterial } from '../materials/fullscreen/BlendMaterial.js';
import { SobolNumberMapGenerator } from '../utils/SobolNumberMapGenerator.js';

const _scissor = new Vector4();
const _viewport = new Vector4();

function* renderTask() {

	const {
		_renderer,
		_fsQuad,
		_blendQuad,
		_primaryTarget,
		_blendTargets,
		_sobolTarget,
		_subframe,
		alpha,
		camera,
		material,
	} = this;
	const _ogScissor = new Vector4();
	const _ogViewport = new Vector4();

	const blendMaterial = _blendQuad.material;
	let [ blendTarget1, blendTarget2 ] = _blendTargets;

	while ( true ) {

		if ( alpha ) {

			blendMaterial.opacity = this._opacityFactor / ( this._samples + 1 );
			material.blending = NoBlending;
			material.opacity = 1;

		} else {

			material.opacity = this._opacityFactor / ( this._samples + 1 );
			material.blending = NormalBlending;

		}

		const [ subX, subY, subW, subH ] = _subframe;

		const w = _primaryTarget.width;
		const h = _primaryTarget.height;
		material.resolution.set( w * subW, h * subH );
		material.sobolTexture = _sobolTarget.texture;
		material.seed ++;

		const tilesX = this.tiles.x || 1;
		const tilesY = this.tiles.y || 1;
		const totalTiles = tilesX * tilesY;
		const dprInv = ( 1 / _renderer.getPixelRatio() );

		for ( let y = 0; y < tilesY; y ++ ) {

			for ( let x = 0; x < tilesX; x ++ ) {

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

				// store og state
				const ogRenderTarget = _renderer.getRenderTarget();
				const ogAutoClear = _renderer.autoClear;
				const ogScissorTest = _renderer.getScissorTest();
				_renderer.getScissor( _ogScissor );
				_renderer.getViewport( _ogViewport );

				let tx = x;
				let ty = y;
				if ( ! this.stableTiles ) {

					const tileIndex = ( this._currentTile ) % ( tilesX * tilesY );
					tx = tileIndex % tilesX;
					ty = ~ ~ ( tileIndex / tilesX );

					this._currentTile = tileIndex + 1;

				}

				// three.js renderer takes values relative to the current pixel ratio
				_renderer.setRenderTarget( _primaryTarget );
				_renderer.setScissorTest( true );

				// set the scissor window for a subtile
				_scissor.x = tx * w / tilesX;
				_scissor.y = ( tilesY - ty - 1 ) * h / tilesY;
				_scissor.z = w / tilesX;
				_scissor.w = h / tilesY;

				// adjust for the subframe
				_scissor.x = subX * w + subW * _scissor.x;
				_scissor.y = subY * h + subH * _scissor.y;
				_scissor.z = subW * _scissor.z;
				_scissor.w = subH * _scissor.w;

				// round for floating point cases
				_scissor.x = _scissor.x;
				_scissor.y = _scissor.y;
				_scissor.z = _scissor.z;
				_scissor.w = _scissor.w;

				// multiply inverse of DPR in because threes multiplies it in
				_scissor.multiplyScalar( dprInv ).ceil();

				_viewport.x = subX * w;
				_viewport.y = subY * h;
				_viewport.z = subW * w;
				_viewport.w = subH * h;
				_viewport.multiplyScalar( dprInv ).ceil();

				_renderer.setScissor( _scissor );
				_renderer.setViewport( _viewport );

				_renderer.autoClear = false;
				_fsQuad.render( _renderer );

				// reset original renderer state
				_renderer.setViewport( _ogViewport );
				_renderer.setScissor( _ogScissor );
				_renderer.setScissorTest( ogScissorTest );
				_renderer.setRenderTarget( ogRenderTarget );
				_renderer.autoClear = ogAutoClear;

				// swap and blend alpha targets
				if ( alpha ) {

					blendMaterial.target1 = blendTarget1.texture;
					blendMaterial.target2 = _primaryTarget.texture;

					_renderer.setRenderTarget( blendTarget2 );
					_blendQuad.render( _renderer );
					_renderer.setRenderTarget( ogRenderTarget );

				}

				this._samples += ( 1 / totalTiles );

				// round the samples value if we've finished the tiles
				if ( x === tilesX - 1 && y === tilesY - 1 ) {

					this._samples = Math.round( this._samples );

				}

				yield;

			}

		}

		[ blendTarget1, blendTarget2 ] = [ blendTarget2, blendTarget1 ];

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

		if ( this._alpha === v ) {

			return;

		}

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

	get samples() {

		return this._samples;

	}

	constructor( renderer ) {

		this.camera = null;
		this.tiles = new Vector2( 1, 1 );

		this.stableNoise = false;
		this.stableTiles = true;

		this._samples = 0;
		this._subframe = new Vector4( 0, 0, 1, 1 );
		this._opacityFactor = 1.0;
		this._renderer = renderer;
		this._alpha = false;
		this._fsQuad = new FullScreenQuad( null );
		this._blendQuad = new FullScreenQuad( new BlendMaterial() );
		this._task = null;
		this._currentTile = 0;

		this._sobolTarget = new SobolNumberMapGenerator().generate( renderer );
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

		w = Math.ceil( w );
		h = Math.ceil( h );

		if ( this._primaryTarget.width === w && this._primaryTarget.height === h ) {

			return;

		}

		this._primaryTarget.setSize( w, h );
		this._blendTargets[ 0 ].setSize( w, h );
		this._blendTargets[ 1 ].setSize( w, h );
		this.reset();

	}

	dispose() {

		this._primaryTarget.dispose();
		this._blendTargets[ 0 ].dispose();
		this._blendTargets[ 1 ].dispose();
		this._sobolTarget.dispose();

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

		this._samples = 0;
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
