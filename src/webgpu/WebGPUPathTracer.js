import { DataTexture, LinearFilter, Vector2, Scene, PerspectiveCamera, Color, NoToneMapping } from 'three/webgpu';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderToScreenNodeMaterial } from './materials/RenderToScreenMaterial.js';
import { MegaKernelPathTracer } from './MegaKernelPathTracer.js';
import { WaveFrontPathTracer } from './WaveFrontPathTracer.js';
import { CubeToEquirectGenerator } from '../utils/CubeToEquirectGenerator.js';
import { ObjectBVH } from './lib/ObjectBVH.js';
import { PathtracerBVHComputeData } from './nodes/PathtracerBVHComputeData.js';

const _resolution = new Vector2();
const _color = new Color();
export class WebGPUPathTracer {

	get bounces() {

		return this._pathTracer.bounces;

	}

	set bounces( v ) {

		this._pathTracer.bounces = v;

	}

	useMegakernel( value ) {

		this._pathTracer.dispose();
		this._pathTracer = value ? new MegaKernelPathTracer( this._renderer ) : new WaveFrontPathTracer( this._renderer );
		this._pathTracer.setBVHData( this._bvhData );
		this.setCamera( this.camera );

	}

	constructor( renderer ) {

		// members
		this._renderer = renderer;
		this._pathTracer = new MegaKernelPathTracer( renderer );

		this._envColorTexture = new DataTexture( );
		this._envColorTexture.image.data = new Uint8Array( [ 255, 255, 255, 255 ] );
		this._envColorTexture.needsUpdate = true;
		this._envColorTexture.minFilter = LinearFilter;
		this._envColorTexture.magFilter = LinearFilter;

		this._backgroundColorTexture = new DataTexture( );
		this._backgroundColorTexture.image.data = new Uint8Array( [ 255, 255, 255, 255 ] );
		this._backgroundColorTexture.needsUpdate = true;
		this._backgroundColorTexture.minFilter = LinearFilter;
		this._backgroundColorTexture.magFilter = LinearFilter;

		// options
		this.renderScale = 1;
		this.synchronizeRenderSize = true;
		this.renderToCanvas = true;
		this._blitQuad = new FullScreenQuad( new RenderToScreenNodeMaterial() );

		// initialize the scene so it doesn't fail
		this.setScene( new Scene(), new PerspectiveCamera() );

	}

	setScene( scene, camera ) {

		scene.updateMatrixWorld( true );
		camera.updateMatrixWorld();

		// Build BVH for each mesh geometry
		scene.traverse( child => {

			if ( child.isMesh && ! child.geometry.boundsTree ) {

				child.geometry.boundsTree = new MeshBVH( child.geometry, { strategy: SAH, maxLeafSize: 5 } );

			}

		} );

		// Build TLAS and compute functions
		const objectBVH = new ObjectBVH( scene, { strategy: SAH } );
		const bvhData = new PathtracerBVHComputeData( objectBVH );
		bvhData.update();

		this._bvhData = bvhData;
		this._pathTracer.setBVHData( bvhData );
		this.setCamera( camera );

		const environment = convertToTexture( this._renderer, scene.environment || _color.set( 0 ), this._envColorTexture );
		const background = convertToTexture( this._renderer, scene.background, this._backgroundColorTexture );

		this._pathTracer.setEnvironment(
			environment,
			scene.environmentIntensity,
			scene.environmentRotation,

			background,
			scene.backgroundIntensity,
			scene.backgroundRotation,
			scene.backgroundBlurriness,
		);

	}

	setCamera( camera ) {

		this.camera = camera;
		this.updateCamera();

	}

	updateCamera() {

		const camera = this.camera;
		camera.updateMatrixWorld();

		this._pathTracer.setCamera( camera );
		this.reset();

	}

	reset() {

		this._pathTracer.reset();

	}

	renderSample() {

		if ( ! this._renderer._initialized ) {

			return;

		}

		this._updateScale();
		this._pathTracer.update();

		const blitQuad = this._blitQuad;
		blitQuad.material.texture = this._pathTracer.outputTarget;

		const renderer = this._renderer;
		const originalToneMapping = renderer.toneMapping;
		const originalExposure = renderer.toneMappingExposure;
		renderer.toneMapping = NoToneMapping;
		renderer.toneMappingExposure = 1.0;
		blitQuad.material.toneMapping = originalToneMapping;
		blitQuad.material.toneMappingExposure = originalExposure;
		blitQuad.render( renderer );
		renderer.toneMapping = originalToneMapping;
		renderer.toneMappingExposure = originalExposure;

	}

	dispose() {

		this._pathTracer.dispose();

	}

	_updateScale() {

		// update the path tracer scale if it has changed
		if ( this.synchronizeRenderSize ) {

			this._renderer.getDrawingBufferSize( _resolution );

			const w = Math.floor( this.renderScale * _resolution.x );
			const h = Math.floor( this.renderScale * _resolution.y );

			this._pathTracer.getSize( _resolution );
			if ( _resolution.x !== w || _resolution.y !== h ) {

				this._pathTracer.setSize( w, h );

			}

		}

	}

	getSampleCount() {

		return this._pathTracer.samples;

	}

	async getLatestSampleTimestamp() {

		return await this._pathTracer.getLatestSampleTimestamp();

	}

}

function convertToTexture( renderer, value, colorTexture ) {

	if ( ! value ) {

		const clearAlpha = renderer.getClearAlpha();
		renderer.getClearColor( _color );

		colorTexture.image.data[ 0 ] = _color.r * 255;
		colorTexture.image.data[ 1 ] = _color.g * 255;
		colorTexture.image.data[ 2 ] = _color.b * 255;
		colorTexture.image.data[ 3 ] = clearAlpha * 255;

		colorTexture.needsUpdate = true;
		value = colorTexture;

	} else if ( value.isColor ) {

		colorTexture.image.data[ 0 ] = value.r * 255;
		colorTexture.image.data[ 1 ] = value.g * 255;
		colorTexture.image.data[ 2 ] = value.b * 255;
		colorTexture.image.data[ 3 ] = 255;
		colorTexture.needsUpdate = true;
		value = colorTexture;

	} else if ( value?.isCubeTexture ) {

		value = new CubeToEquirectGenerator( renderer ).generate( value );

	}

	return value;

}
