import { Color, StorageBufferAttribute, PerspectiveCamera, Scene, Vector2, Clock } from 'three/webgpu';
import { PathTracingSceneGenerator } from '../core/PathTracingSceneGenerator.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderToScreenNodeMaterial } from './materials/RenderToScreenMaterial.js';
import { MegaKernelPathTracer } from './MegaKernelPathTracer.js';
import { WaveFrontPathTracer } from './WaveFrontPathTracer.js';

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
		this._generator = new PathTracingSceneGenerator();

	}

	constructor( renderer ) {

		// members
		this._renderer = renderer;
		this._generator = new PathTracingSceneGenerator();
		// this._pathTracer = new MegaKernelPathTracer( renderer );
		this._pathTracer = new WaveFrontPathTracer( renderer );
		this._queueReset = false;
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

		const generator = this._generator;
		generator.setObjects( scene );

		const result = generator.generate();
		return this._updateFromResults( scene, camera, result );

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

	_updateFromResults( scene, camera, results ) {

		const {
			materials,
			geometry,
			bvh,
			bvhChanged,
			needsMaterialIndexUpdate,
		} = results;

		const pathTracer = this._pathTracer;

		const newGeometryData = {};

		if ( bvhChanged ) {

			// dereference a new index attribute if we're using indirect storage
			const dereferencedIndexAttr = geometry.index.clone();
			const indirectBuffer = bvh._indirectBuffer;
			if ( indirectBuffer ) {

				dereferenceIndex( geometry, indirectBuffer, dereferencedIndexAttr );

			}

			const newIndex = new StorageBufferAttribute( dereferencedIndexAttr.array, 3 );
			newIndex.name = 'Geometry Index';
			newGeometryData.index = newIndex;

			const newPosition = new StorageBufferAttribute( geometry.attributes.position.array, 3 );
			newPosition.name = 'Geometry Positions';
			newGeometryData.position = newPosition;

			const newNormals = new StorageBufferAttribute( geometry.attributes.normal.array, 3 );
			newNormals.name = 'Geometry Normals';
			newGeometryData.normal = newNormals;

			const newBvhRoots = new StorageBufferAttribute( new Float32Array( bvh._roots[ 0 ] ), 8 );
			newBvhRoots.name = 'BVH Roots';
			newGeometryData.bvh = newBvhRoots;

		}

		if ( needsMaterialIndexUpdate ) {

			const newMaterialIndex = new StorageBufferAttribute( geometry.attributes.materialIndex.array, 1 );
			newMaterialIndex.name = 'Material Index';
			newGeometryData.materialIndex = newMaterialIndex;

		}

		const newMaterialsData = new Float32Array( materials.length * 3 );
		const defaultColor = new Color();
		for ( let i = 0; i < materials.length; i ++ ) {

			const material = materials[ i ];
			const color = material.color ?? defaultColor;
			// Make sure those are in linear-sRGB space
			newMaterialsData[ 3 * i + 0 ] = color.r;
			newMaterialsData[ 3 * i + 1 ] = color.g;
			newMaterialsData[ 3 * i + 2 ] = color.b;

		}

		const newMaterialsBuffer = new StorageBufferAttribute( newMaterialsData, 3 );
		newMaterialsBuffer.name = 'Material Data';
		newGeometryData.materials = newMaterialsBuffer;

		pathTracer.setGeometryData( newGeometryData );

		this.setCamera( camera );

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

// TODO: Expose in three-mesh-bvh?
function dereferenceIndex( geometry, indirectBuffer, target ) {

	const unpacked = target.array;
	const indexArray = geometry.index ? geometry.index.array : null;
	for ( let i = 0, l = indirectBuffer.length; i < l; i ++ ) {

		const i3 = 3 * i;
		const v3 = 3 * indirectBuffer[ i ];
		for ( let c = 0; c < 3; c ++ ) {

			unpacked[ i3 + c ] = indexArray ? indexArray[ v3 + c ] : v3 + c;

		}

	}

}
