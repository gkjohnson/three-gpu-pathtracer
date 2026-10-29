import { ComputeKernel } from './ComputeKernel.js';
import { textureStore, globalId } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { createAuxImageTarget, createAuxTarget } from './targets.js';
import { unpackAuxAlbedoFn, unpackAuxNormalFn, AUX_LAYERS } from '../nodes/aux.wgsl.js';

// Unpacks the auxiliary target into separate albedo and normal images
export class UnpackAuxKernel extends ComputeKernel {

	constructor() {

		const params = {
			auxTarget: textureStore( createAuxTarget() ).toReadOnly(),
			albedoTarget: textureStore( createAuxImageTarget() ).toWriteOnly(),
			normalTarget: textureStore( createAuxImageTarget() ).toWriteOnly(),
			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( globalId: vec3u ) -> void {

				let dims = textureDimensions( ${ params.auxTarget } );
				if ( globalId.x >= dims.x || globalId.y >= dims.y ) {

					return;

				}

				var packed: vec3u;
				for ( var layer = 0u; layer < ${ AUX_LAYERS }u; layer ++ ) {

					packed[ layer ] = textureLoad( ${ params.auxTarget }, globalId.xy, layer ).r;

				}

				textureStore( ${ params.albedoTarget }, globalId.xy, vec4f( ${ unpackAuxAlbedoFn }( packed ), 1.0 ) );
				textureStore( ${ params.normalTarget }, globalId.xy, vec4f( ${ unpackAuxNormalFn }( packed ), 1.0 ) );

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
