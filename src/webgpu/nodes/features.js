import { wgslTagCode } from 'three-mesh-bvh/webgpu';

// kernel code that's only compiled in when the shading model uses the feature, like the WebGL "FEATURE_*" defines,
// e.g. ${ ifFeature( 'FOG' )/* wgsl */`if ( materialMedium.fogVolume ) { ... }` }. The kernel context needs the shading model
export const ifFeature = feature => ( tokens, ...args ) => {

	const code = wgslTagCode( tokens, ...args );
	return builder => builder.getContext().shadingModel.features.isUsed( feature ) ? code : '';

};
