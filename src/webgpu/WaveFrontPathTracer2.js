import { Matrix4 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { storage } from 'three/tsl';
import { PathTracerBackend } from './PathTracerBackend.js';
import { EquirectHdrInfoUniform } from '../uniforms/EquirectHdrInfoUniform.js';
import { PopulatePixelIndices } from './compute/wavefront2/PopulatePixelIndicesKernel.js';
import { LogicKernel } from './compute/wavefront2/LogicKernel.js';
import { MaterialKernel } from './compute/wavefront2/MaterialKernel.js';
import { TraceRayKernel } from './compute/wavefront2/TraceRayKernel.js';
import { TraceShadowRayKernel } from './compute/wavefront2/TraceShadowRay.js';
import { ZeroOutBufferKernel } from './compute/ZeroOutBufferKernel.js';
import { QueueLengthToDispatchKernel } from './compute/wavefront2/QueueLengthToDispatchKernel.js';
import { lightStruct } from './nodes/structs.wgsl.js';
import { rayDataStruct, intersectionResultStruct, rayQueueStruct } from './compute/wavefront2/structs.js';
import { rayStruct } from './lib/wgsl/structs.wgsl.js';

const MAX_BUFFER_SIZE = 128 * 1024 * 1024;
const MAX_RAY_DATA_COUNT = Math.floor( MAX_BUFFER_SIZE / ( rayDataStruct.getLength() * 4 ) );
const RAY_QUEUE_HEADER_FLOATS = 4;
const PIXEL_QUEUE_HEADER_FLOATS = 1;

export class WaveFrontPathTracer2 extends PathTracerBackend {

	constructor( renderer ) {

		super( renderer );

		this.envInfo = new EquirectHdrInfoUniform();
		this.seed = 0;

		this.rayData = new StorageBufferAttribute( MAX_RAY_DATA_COUNT, rayDataStruct.getLength() );
		this.rayData.name = 'Ray Data';

		const queueSize = RAY_QUEUE_HEADER_FLOATS + MAX_RAY_DATA_COUNT * rayStruct.getLength();
		this.rayQueue = new StorageBufferAttribute( new Float32Array( queueSize ), queueSize );
		this.rayQueue.name = 'Ray Queue';

		this.shadowRayQueue = new StorageBufferAttribute( new Float32Array( queueSize ), queueSize );
		this.shadowRayQueue.name = 'Shadow Ray Queue';

		this.rayIntersections = new StorageBufferAttribute( MAX_RAY_DATA_COUNT, intersectionResultStruct.getLength() );
		this.rayIntersections.name = 'Ray Intersections';

		this.shadowRayIntersections = new StorageBufferAttribute( MAX_RAY_DATA_COUNT, intersectionResultStruct.getLength() );
		this.shadowRayIntersections.name = 'Shadow Ray Intersections';

		this.pixelQueue = null;

		this.populatePixelIndicesKernel = new PopulatePixelIndices().setWorkgroupSize( 8, 8, 1 );
		this.logicKernel = new LogicKernel().setWorkgroupSize( 64, 1, 1 );
		this.materialKernel = new MaterialKernel().setWorkgroupSize( 64, 1, 1 );
		this.traceRayKernel = new TraceRayKernel().setWorkgroupSize( 64, 1, 1 );
		this.traceShadowRayKernel = new TraceShadowRayKernel().setWorkgroupSize( 64, 1, 1 );

		this.zeroQueueKernel = new ZeroOutBufferKernel().setWorkgroupSize( 1, 1, 1 );

		this.rayDispatchConverter = new QueueLengthToDispatchKernel( rayQueueStruct ).setWorkgroupSize( 1, 1, 1 );
		this.shadowDispatchConverter = new QueueLengthToDispatchKernel( rayQueueStruct ).setWorkgroupSize( 1, 1, 1 );

		this.setMaterial( this.material );

	}

	_updatePixelQueue( width, height ) {

		const overflowCount = Math.max( 0, width * height - MAX_RAY_DATA_COUNT );
		const size = Math.max( PIXEL_QUEUE_HEADER_FLOATS + overflowCount, 3 );
		if ( this.pixelQueue ) {

			this.pixelQueue.dispose();

		}

		this.pixelQueue = new StorageBufferAttribute( new Float32Array( size ), size );
		this.pixelQueue.name = 'Pixel Queue';

	}

	setBVHData( bvhData ) {

		this.traceRayKernel.bvhData = bvhData;
		this.traceRayKernel.needsUpdate = true;

		this.traceShadowRayKernel.bvhData = bvhData;
		this.traceShadowRayKernel.needsUpdate = true;

		this.materialKernel.bvhData = bvhData;
		this.materialKernel.needsUpdate = true;

		this.reset();

	}

	setTextures( textures ) {

		this.materialKernel.textures = textures;
		this.materialKernel.kernel.computeNode.parameters.textureSampler.node.value = textures;

	}

	setLights( lightsAttribute, lightCount, iesProfiles ) {

		const lightsNode = storage( lightsAttribute, lightStruct ).setName( 'g_lights' ).toReadOnly();
		const kernel = this.logicKernel;

		kernel.lights = lightsNode;
		kernel.lightCount = lightCount;
		kernel.iesProfiles = iesProfiles;
		kernel.kernel.computeNode.parameters.iesProfilesSampler.node.value = iesProfiles;
		kernel.needsUpdate = true;

	}

	setMaterial( material ) {

		this.material = material;
		this.materialKernel.material = material.getData();
		this.materialKernel.needsUpdate = true;
		this.reset();

	}

	setEnvironment(
		envMap,
		envMapIntensity,
		envMapRotation,

		background,
		backgroundIntensity,
		backgroundRotation,
		backgroundBlurriness,
	) {

		if ( envMap !== null ) {

			this.envInfo.updateFrom( envMap );

		}

		const kernel = this.logicKernel;

		kernel.envMap = this.envInfo.map;
		kernel.kernel.computeNode.parameters.envMapSampler.node.value = this.envInfo.map;

		kernel.totalSum = this.envInfo.totalSum;

		const envRotationMatrix4 = new Matrix4().makeRotationFromEuler( envMapRotation ).invert();
		kernel.envMapRotation.setFromMatrix4( envRotationMatrix4 );
		kernel.invEnvMapRotation.copy( kernel.envMapRotation ).invert();
		kernel.envMapIntensity = envMapIntensity;

		kernel.envMapMarginalWeights = this.envInfo.marginalWeights;
		kernel.kernel.computeNode.parameters.envMapMarginalWeightsSampler.node.value = this.envInfo.marginalWeights;

		kernel.envMapConditionalWeights = this.envInfo.conditionalWeights;
		kernel.kernel.computeNode.parameters.envMapConditionalWeightsSampler.node.value = this.envInfo.conditionalWeights;

		if ( kernel.background.isTexture ) {

			kernel.background.dispose();

		}

		kernel.background = background;
		kernel.kernel.computeNode.parameters.backgroundSampler.node.value = background;

		const bgRotationMatrix4 = new Matrix4().makeRotationFromEuler( backgroundRotation ).invert();
		kernel.backgroundRotation.setFromMatrix4( bgRotationMatrix4 );
		kernel.backgroundIntensity = backgroundIntensity;
		kernel.backgroundBlurriness = backgroundBlurriness;

	}

	setSize( w, h ) {

		w = Math.ceil( w );
		h = Math.ceil( h );
		const { width, height } = this.outputTarget;
		if ( width === w && height === h ) {

			return false;

		}

		this.outputTarget.dispose();
		this.prevOutputTarget.dispose();
		this.sampleCountTarget.dispose();

		this.outputTarget = this.outputTarget.clone();
		this.prevOutputTarget = this.outputTarget.clone();
		this.sampleCountTarget = this.sampleCountTarget.clone();

		this.outputTarget.setSize( w, h );
		this.prevOutputTarget.setSize( w, h );
		this.sampleCountTarget.setSize( w, h );

		this._updatePixelQueue( w, h );
		this.reset();
		return true;

	}

	dispose() {

		super.dispose();
		this.envInfo.dispose();

		this.rayData.dispose();
		this.rayQueue.dispose();
		this.shadowRayQueue.dispose();
		this.rayIntersections.dispose();
		this.shadowRayIntersections.dispose();
		if ( this.pixelQueue ) {

			this.pixelQueue.dispose();

		}

	}

	reset() {

		const {
			renderer,
			zeroQueueKernel,
			outputTarget,
			rayQueue,
			shadowRayQueue,
			pixelQueue,
			populatePixelIndicesKernel,
		} = this;

		if ( ! renderer.initialized ) {

			return;

		}

		super.reset();

		this.seed = 0;

		zeroQueueKernel.target = rayQueue;
		renderer.compute( zeroQueueKernel.kernel, [ RAY_QUEUE_HEADER_FLOATS ] );

		zeroQueueKernel.target = shadowRayQueue;
		renderer.compute( zeroQueueKernel.kernel, [ RAY_QUEUE_HEADER_FLOATS ] );

		if ( pixelQueue ) {

			const { width, height } = outputTarget;
			populatePixelIndicesKernel.rayData = this.rayData;
			populatePixelIndicesKernel.pixelQueue = pixelQueue;
			populatePixelIndicesKernel.targetDimensions.set( width, height );
			renderer.compute( populatePixelIndicesKernel.kernel, populatePixelIndicesKernel.getDispatchSize( width, height, 1 ) );

		}

	}

	*createRenderTask() {

		const { renderer, camera, bounces } = this;
		const { width, height } = this.outputTarget;
		camera.updateMatrixWorld();

		while ( true ) {

			const rayCount = Math.min( MAX_RAY_DATA_COUNT, width * height );

			renderer.copyTextureToTexture( this.outputTarget, this.prevOutputTarget );
			[ this.outputTarget, this.prevOutputTarget ] = [ this.prevOutputTarget, this.outputTarget ];

			this.logicKernel.rayData = this.rayData;
			this.logicKernel.rayIntersections = this.rayIntersections;
			this.logicKernel.shadowRayIntersections = this.shadowRayIntersections;
			this.logicKernel.prevOutputTarget = this.prevOutputTarget;
			this.logicKernel.outputTarget = this.outputTarget;
			this.logicKernel.sampleCountTarget = this.sampleCountTarget;
			this.logicKernel.seed = this.seed;
			this.logicKernel.bounces = bounces;
			renderer.compute( this.logicKernel.kernel, this.logicKernel.getDispatchSize( rayCount, 1, 1 ) );

			this.zeroQueueKernel.target = this.rayQueue;
			renderer.compute( this.zeroQueueKernel.kernel, [ RAY_QUEUE_HEADER_FLOATS ] );

			this.zeroQueueKernel.target = this.shadowRayQueue;
			renderer.compute( this.zeroQueueKernel.kernel, [ RAY_QUEUE_HEADER_FLOATS ] );

			this.materialKernel.rayData = this.rayData;
			this.materialKernel.rayQueue = this.rayQueue;
			this.materialKernel.shadowRayQueue = this.shadowRayQueue;
			this.materialKernel.pixelQueue = this.pixelQueue;
			this.materialKernel.cameraToModelMatrix.copy( camera.matrixWorld );
			this.materialKernel.inverseProjectionMatrix.copy( camera.projectionMatrixInverse );
			this.materialKernel.seed = this.seed;
			this.materialKernel.bounces = bounces;
			this.materialKernel.targetDimensions.set( width, height );
			renderer.compute( this.materialKernel.kernel, this.materialKernel.getDispatchSize( rayCount, 1, 1 ) );

			this.rayDispatchConverter.queue = this.rayQueue;
			renderer.compute( this.rayDispatchConverter.kernel, [ 1, 1, 1 ] );

			this.traceRayKernel.rayQueue = this.rayQueue;
			this.traceRayKernel.rayIntersectionQueue = this.rayIntersections;
			renderer.compute( this.traceRayKernel.kernel, this.rayDispatchConverter.outputDispatch );

			this.shadowDispatchConverter.queue = this.shadowRayQueue;
			renderer.compute( this.shadowDispatchConverter.kernel, [ 1, 1, 1 ] );

			this.traceShadowRayKernel.shadowRayQueue = this.shadowRayQueue;
			this.traceShadowRayKernel.shadowRayIntersectionQueue = this.shadowRayIntersections;
			renderer.compute( this.traceShadowRayKernel.kernel, this.shadowDispatchConverter.outputDispatch );

			this.samples ++;

			this.seed ++;
			yield;

		}

	}

}
