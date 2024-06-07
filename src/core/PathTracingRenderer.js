import { RGBAFormat, FloatType, Color, Vector2, WebGLRenderTarget, NoBlending, NormalBlending, Vector4, NearestFilter } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { BlendMaterial } from '../materials/fullscreen/BlendMaterial.js';
import { SobolNumberMapGenerator } from '../utils/SobolNumberMapGenerator.js';
import { PhysicalPathTracingMaterial } from '../materials/pathtracing/PhysicalPathTracingMaterial.js';

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
		material,
	} = this;
	const _ogScissor = new Vector4();
	const _ogViewport = new Vector4();

	const blendMaterial = _blendQuad.material;
	let [ blendTarget1, blendTarget2 ] = _blendTargets;

	while ( true ) {

		if ( alpha ) {

			blendMaterial.opacity = this._opacityFactor / ( this.samples + 1 );
			material.blending = NoBlending;
			material.opacity = 1;

		} else {

			material.opacity = this._opacityFactor / ( this.samples + 1 );
			material.blending = NormalBlending;

		}

		const [ subX, subY, subW, subH ] = _subframe;

		const w = _primaryTarget.width;
		const h = _primaryTarget.height;
		material.resolution.set( w * subW, h * subH );
		material.sobolTexture = _sobolTarget.texture;
		material.stratifiedTexture.init( 20, material.bounces + material.transmissiveBounces + 5 );
		material.stratifiedTexture.next();
		material.seed ++;

		const tilesX = this.tiles.x || 1;
		const tilesY = this.tiles.y || 1;
		const totalTiles = tilesX * tilesY;

		const pxSubW = Math.ceil( w * subW );
		const pxSubH = Math.ceil( h * subH );
		const pxSubX = Math.floor( subX * w );
		const pxSubY = Math.floor( subY * h );

		const pxTileW = Math.ceil( pxSubW / tilesX );
		const pxTileH = Math.ceil( pxSubH / tilesY );

		for ( let y = 0; y < tilesY; y ++ ) {

			for ( let x = 0; x < tilesX; x ++ ) {

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

				// set the scissor and the viewport on the render target
				// note that when using the webgl renderer set viewport the device pixel ratio
				// is multiplied into the field causing some pixels to not be rendered
				const reverseTy = tilesY - ty - 1;
				_primaryTarget.scissor.set(
					pxSubX + tx * pxTileW,
					pxSubY + reverseTy * pxTileH,
					Math.min( pxTileW, pxSubW - tx * pxTileW ),
					Math.min( pxTileH, pxSubH - reverseTy * pxTileH ),
				);

				_primaryTarget.viewport.set(
					pxSubX,
					pxSubY,
					pxSubW,
					pxSubH,
				);

				// three.js renderer takes values relative to the current pixel ratio
				_renderer.setRenderTarget( _primaryTarget );
				_renderer.setScissorTest( true );

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

				this.samples += ( 1 / totalTiles );

				// round the samples value if we've finished the tiles
				if ( x === tilesX - 1 && y === tilesY - 1 ) {

					this.samples = Math.round( this.samples );

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

		this._fsQuad.material.removeEventListener( 'recompilation', this._compileFunction );
		v.addEventListener( 'recompilation', this._compileFunction );

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

	get isCompiling() {

		return Boolean( this._compilePromise );

	}

	constructor( renderer ) {

		this.camera = null;
		this.tiles = new Vector2( 3, 3 );

		this.stableNoise = false;
		this.stableTiles = true;

		this.samples = 0;
		this._subframe = new Vector4( 0, 0, 1, 1 );
		this._opacityFactor = 1.0;
		this._renderer = renderer;
		this._alpha = false;
		this._fsQuad = new FullScreenQuad( new PhysicalPathTracingMaterial() );
		this._blendQuad = new FullScreenQuad( new BlendMaterial() );
		this._task = null;
		this._currentTile = 0;
		this._compilePromise = null;

		this._sobolTarget = new SobolNumberMapGenerator().generate( renderer );

		this._primaryTarget = new WebGLRenderTarget( 1, 1, {
			format: RGBAFormat,
			type: FloatType,
			magFilter: NearestFilter,
			minFilter: NearestFilter,
		} );
		this._blendTargets = [
			new WebGLRenderTarget( 1, 1, {
				format: RGBAFormat,
				type: FloatType,
				magFilter: NearestFilter,
				minFilter: NearestFilter,
			} ),
			new WebGLRenderTarget( 1, 1, {
				format: RGBAFormat,
				type: FloatType,
				magFilter: NearestFilter,
				minFilter: NearestFilter,
			} ),
		];

		// function for listening to for triggered compilation so we can wait for compilation to finish
		// before starting to render
		this._compileFunction = () => {

			const promise = this.compileMaterial( this._fsQuad._mesh );
			promise.then( () => {

				if ( this._compilePromise === promise ) {

					this._compilePromise = null;

				}

			} );

			this._compilePromise = promise;

		};

		this.material.addEventListener( 'recompilation', this._compileFunction );

	}

	compileMaterial() {

		return this._renderer.compileAsync( this._fsQuad._mesh );

	}

	setCamera( camera ) {

		const { material } = this;
		material.cameraWorldMatrix.copy( camera.matrixWorld );
		material.invProjectionMatrix.copy( camera.projectionMatrixInverse );
		material.physicalCamera.updateFrom( camera );

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

		this.camera = camera;

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

	getSize( target ) {

		target.x = this._primaryTarget.width;
		target.y = this._primaryTarget.height;

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

		this.samples = 0;
		this._task = null;

		this.material.stratifiedTexture.stableNoise = this.stableNoise;
		if ( this.stableNoise ) {

			this.material.seed = 0;
			this.material.stratifiedTexture.reset();

		}

	}

	update() {

		// ensure we've updated our defines before rendering so we can ensure we
		// can wait for compilation to finish
		this.material.onBeforeRender();
		if ( this.isCompiling ) {

			return;

		}

		if ( ! this._task ) {

			this._task = renderTask.call( this );

		}

		this._task.next();

	}

}
