import { Vector2, Clock, Scene, PerspectiveCamera } from 'three/webgpu';
import { MeshBVH, SAH } from 'three-mesh-bvh';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderToScreenNodeMaterial } from './materials/RenderToScreenMaterial.js';
import { MegaKernelPathTracer } from './MegaKernelPathTracer.js';
import { WaveFrontPathTracer } from './WaveFrontPathTracer.js';
import { ObjectBVH } from './lib/ObjectBVH.js';
import { PathtracerBVHComputeData } from './lib/PathtracerBVHComputeData.js';

const _resolution = new Vector2();
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
		this._clock = new Clock();

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
		blitQuad.render( this._renderer );

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
