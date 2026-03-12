import { wgslFn } from 'three/tsl';
import { constants, surfaceRecordStruct } from './structs.wgsl';
import { ggxDistributionFunc, ggxShadowMaskG2Func, schlickFresnelFunc, schlickFresnelVecFunc } from './sampling.wgsl';
import { iorToF0Func } from './material.wgsl';

export const diffuseBrdfFunc = wgslFn( /* wgslFn */ `

	fn diffuseBrdf( NdotV: f32, NdotL: f32, VdotH: f32, surf: SurfaceRecord ) -> vec3f {

		// https://blog.selfshadow.com/publications/s2015-shading-course/burley/s2015_pbs_disney_bsdf_notes.pdf
		// See equation (4)

		let fl = schlickFresnel( NdotL, 0.0 );
		let fv = schlickFresnel( NdotV, 0.0 );

		let rr = 2.0 * surf.roughness * VdotH * VdotH;
		let retro = rr * ( fl + fv + fl * fv * ( rr - 1.0f ) );
		let fresnel = ( 1.0f - 0.5f * fl ) * ( 1.0f - 0.5f * fv );

		// TODO: subsurface approx?

		return ( surf.color / PI ) * ( retro + fresnel );

	}

`, [ constants, schlickFresnelFunc, surfaceRecordStruct ] );

export const specularBrdfFunc = wgslFn( /* wgslFn */ `

	fn specularBrdf( NdotL: f32, NdotV: f32, NdotH: f32, alpha: f32 ) -> vec3f {

		let Vis = ggxShadowMaskG2( NdotV, NdotL, alpha );
		let D = ggxDistribution( NdotH, alpha );

		return vec3f( D * Vis );

	}

`, [ ggxDistributionFunc, ggxShadowMaskG2Func ] );

export const fresnelMixFunc = wgslFn( /* wgslFn */ `

	fn fresnelMix( VdotH: f32, ior: f32, base: vec3f, layer: vec3f ) -> vec3f {

		let f0 = iorToF0( ior );
  	let F = schlickFresnel( abs( VdotH ), f0 );
  	return base + F * layer;

	}

`, [ schlickFresnelFunc, iorToF0Func ] );

export const conductorFresnelFunc = wgslFn( /* wgslFn */ `

	fn conductorFresnel( VdotH: f32, f0: vec3f, bsdf: vec3f ) -> vec3f {

	  return bsdf * schlickFresnelVec( abs( VdotH ), f0, vec3f( 1 ) );

	}

`, [ schlickFresnelVecFunc ] );
