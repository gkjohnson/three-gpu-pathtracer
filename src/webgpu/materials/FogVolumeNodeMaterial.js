import { BackSide, MeshBasicNodeMaterial, Vector3 } from 'three/webgpu';
import { Fn, uniform, vec4, positionWorld, positionView, cameraPosition, cameraNear, cameraFar, modelWorldMatrixInverse, viewportDepthTexture, perspectiveDepthToViewZ, screenUV } from 'three/tsl';

/**
 * A homogeneous fog volume, filling the mesh it's applied to. The path tracer scatters light through it as
 * it does a `FogVolumeMaterial`. Rasterized, it draws as unlit haze in its color, as opaque as the fog a
 * view ray crosses inside the mesh's bounding box before reaching the scene.
 */
export class FogVolumeNodeMaterial extends MeshBasicNodeMaterial {

	static get type() {

		return 'FogVolumeNodeMaterial';

	}

	/**
	 * @param {Object} [parameters]
	 */
	constructor( parameters ) {

		super();

		this.isFogVolumeMaterial = true;

		/**
		 * Extinction of the fog per unit of distance.
		 * @type {number}
		 * @default 0.015
		 */
		this.density = 0.015;

		/**
		 * Henyey-Greenstein anisotropy of the light scattered by the fog, from -1 to 1. Path tracing only.
		 * @type {number}
		 * @default 0
		 */
		this.scatterAnisotropy = 0.0;

		// the back faces cover the volume whether the camera is inside or out, and the scene depth
		// rather than the depth test stops the fog at surfaces
		this.side = BackSide;
		this.transparent = true;
		this.depthTest = false;
		this.depthWrite = false;

		const density = uniform( 0 ).onObjectUpdate( ( { material } ) => material.density );
		const boxMin = uniform( new Vector3() ).onObjectUpdate( ( { object } ) => getBoundingBox( object ).min );
		const boxMax = uniform( new Vector3() ).onObjectUpdate( ( { object } ) => getBoundingBox( object ).max );

		this.opacityNode = Fn( () => {

			// the view ray against the bounding box in local space, where distances along it stay in world units
			const toFragment = positionWorld.sub( cameraPosition );
			const origin = modelWorldMatrixInverse.mul( vec4( cameraPosition, 1 ) ).xyz;
			const direction = modelWorldMatrixInverse.mul( vec4( toFragment.normalize(), 0 ) ).xyz;
			const t0 = boxMin.sub( origin ).div( direction );
			const t1 = boxMax.sub( origin ).div( direction );
			const near = t0.min( t1 );
			const far = t0.max( t1 );
			const entry = near.x.max( near.y ).max( near.z ).max( 0 );

			// the scene surface along the same ray, from the depth buffer
			const sceneViewZ = perspectiveDepthToViewZ( viewportDepthTexture( screenUV ), cameraNear, cameraFar );
			const sceneDistance = toFragment.length().mul( sceneViewZ.div( positionView.z ) );
			const exit = far.x.min( far.y ).min( far.z ).min( sceneDistance );

			return exit.sub( entry ).max( 0 ).mul( density ).negate().exp().oneMinus();

		} )();

		this.setValues( parameters );

	}

}

function getBoundingBox( object ) {

	const { geometry } = object;
	if ( geometry.boundingBox === null ) {

		geometry.computeBoundingBox();

	}

	return geometry.boundingBox;

}
