import { wgslTagCode } from 'three-mesh-bvh/webgpu';

// Template tag for a block of kernel code that's only compiled in when the shading model reports the feature,
// like the "FEATURE_*" defines of the WebGL material. Read from the build context, so a change to the feature set
// takes effect when the kernels are rebuilt:
//
// ${ ifFeature( 'FOG' )/* wgsl */`
//     if ( isFogBoundary ) { ... }
// ` }
export const ifFeature = feature => ( tokens, ...args ) => {

	const code = wgslTagCode( tokens, ...args );
	return builder => builder.getContext().shadingModel?.features.isUsed( feature ) ? code : '';

};
