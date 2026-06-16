import { wgslFn } from 'three/tsl';
import { scatterRecordStruct } from './structs.wgsl.js';
import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode.js';

export const inverseMat3x3Func = wgslFn( /* wgsl */ `

	fn inverse(m: mat3x3f) -> mat3x3f {
		var adj: mat3x3f;
		adj[0][0] =   (m[1][1] * m[2][2] - m[2][1] * m[1][2]);
		adj[1][0] = - (m[1][0] * m[2][2] - m[2][0] * m[1][2]);
		adj[2][0] =   (m[1][0] * m[2][1] - m[2][0] * m[1][1]);
		adj[0][1] = - (m[0][1] * m[2][2] - m[2][1] * m[0][2]);
		adj[1][1] =   (m[0][0] * m[2][2] - m[2][0] * m[0][2]);
		adj[2][1] = - (m[0][0] * m[2][1] - m[2][0] * m[0][1]);
		adj[0][2] =   (m[0][1] * m[1][2] - m[1][1] * m[0][2]);
		adj[1][2] = - (m[0][0] * m[1][2] - m[1][0] * m[0][2]);
		adj[2][2] =   (m[0][0] * m[1][1] - m[1][0] * m[0][1]);

		let det = ( m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
			- m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
			+ m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]));

		return adj * ( 1.0 / det );
	}

` );

export const getBasisFromNormalFunc = wgslFn( /* wgsl */ `

	fn getBasisFromNormal( normal: vec3f ) -> mat3x3f {

		var other: vec3f;
		if ( abs( normal.x ) > 0.5 ) {

			other = vec3f( 0.0, 1.0, 0.0 );

		} else {

			other = vec3f( 1.0, 0.0, 0.0 );

		}

		let ortho = normalize( cross( normal, other ) );
		let ortho2 = normalize( cross( normal, ortho ) );
		return mat3x3f( ortho2, ortho, normal );

	}

` );

export const iorToF0Func = wgslFn( /* wgsl */ `

	fn iorToF0( ior: f32 ) -> f32 {
		return pow( ( 1 - ior ) / ( 1 + ior ), 2 );
	}

` );

export const iorToF0GeneralFunc = wgslFn( /* wgsl */ `

	fn iorToF0General( transmittedIor: f32, incidentIor: f32 ) -> f32 {

		return pow( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ), 2 );

	}

` );

export const iorToF0GeneralVecFunc = wgslFn( /* wgsl */ `

	fn iorToF0GeneralVec( transmittedIor: vec3f, incidentIor: vec3f ) -> vec3f {

		let v = ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor );
		return v * v;

	}

` );

export const fresnel0ToIorFunc = wgslFn( /* wgsl */ `

	fn fresnel0ToIor( f0: vec3f ) -> vec3f {

		let sqrtF0 = sqrt( f0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );

	}

` );

export const schlickFresnelFunc = wgslFn( /* wgsl */ `

	fn schlickFresnel( cosine: f32, f0: f32 ) -> f32 {

		return f0 + ( 1.0 - f0 ) * pow( 1.0 - cosine, 5.0 );

	}

` );

export const schlickFresnelVecFunc = wgslFn( /* wgsl */ `

	fn schlickFresnelVec( cosine: f32, f0: vec3f, f90: vec3f ) -> vec3f {

		return f0 + ( f90 - f0 ) * pow( 1.0 - cosine, 5.0 );

	}

` );

export const totalInternalReflectionFunc = wgslFn( /* wgsl */ `

	fn totalInternalReflection( cosTheta: f32, eta: f32 ) -> bool {

		let sinTheta = sqrt( 1.0 - cosTheta * cosTheta );
		return eta * sinTheta > 1.0;

	}

` );

export const evaluateFresnelFunc = wgslFn( /* wgsl */ `

	fn evaluateFresnel( cosine: f32, eta: f32, f0: vec3f, f90: vec3f ) -> vec3f {

		if ( totalInternalReflection( cosine, eta ) ) {

			return f90;

		}

		return f0 + ( f90 - f0 ) * pow( 1.0 - cosine, 5.0 );
	}

`, [ totalInternalReflectionFunc ] );

export const isTerminatingScatterFunc = wgslFn( /* wgsl */ `

	fn isTerminatingScatter( scatterRec: ScatterRecord ) -> bool {
		return scatterRec.pdf <= 0;
	}

`, [ scatterRecordStruct ] );

export const applyWrapFunc = wgslFn( /* wgsl */ `

	fn applyWrap( v: f32, wrapMode: i32 ) -> f32 {

		var res = v;
		if ( wrapMode == 1 ) {

			// ClampToEdge
			res = clamp( res, 0.0, 1.0 );

		} else if ( wrapMode == 2 ) {

			// MirroredRepeat
			res = 1.0 - abs( 2.0 * fract( res * 0.5 ) - 1.0 );

		} else {

			// Repeat
			res = fract( res );

		}

		return res;

	}

` );

// Factory: builds sampleTexel bound to the given per-instance textureInfo uniform
// array node ( must be named "textureInfo" ). Called once per scene so a single
// sampleTexel / textureInfo binding is shared by every caller in a pipeline.
export const sampleTexelFunc = ( textureInfoUniform, atlas, atlasSampler ) => wgslTagFn/* wgsl */ `

	fn sampleTexel( uv: vec2f, packed: i32, lod: f32 ) -> vec4f {

		let wrapS    = ( packed >> 24 ) & 0x3;
		let wrapT    = ( packed >> 26 ) & 0x3;
		let nearest  = ( packed >> 28 ) & 0x1;
		let texIndex = packed & 0xFFFFFF;

		// look up the texture's rect and page within the atlas. three wraps a
		// uniformArray in a struct ( textureInfoStruct ) with a "value" array member.
		let info   = ${ textureInfoUniform }[ u32( texIndex ) ];
		let offset = vec2f( vec2u( info.x & 0xFFFFu, info.x >> 16u ) );
		let size   = vec2f( vec2u( info.y & 0xFFFFu, info.y >> 16u ) );
		let page   = i32( info.z & 0xFFFFu );

		// wrap is applied on the logical uv first, then remapped into the tile
		let wrappedUv = vec2f(
			${ applyWrapFunc }( uv.x, wrapS ),
			${ applyWrapFunc }( uv.y, wrapT ),
		);

		let pageDim = vec2f( textureDimensions( ${ atlas }, 0 ).xy );

		if ( nearest == 1 ) {

			let tileTexel = clamp( vec2i( wrappedUv * size ), vec2i( 0 ), vec2i( size ) - vec2i( 1 ) );
			return textureLoad( ${ atlas }, vec2i( offset ) + tileTexel, page, 0 );

		} else {

			var atlasUv = ( offset + wrappedUv * size ) / pageDim;

			// clamp to half a texel inside the tile so bilinear taps never bleed into
			// neighboring atlas tiles
			let minUv = ( offset + vec2f( 0.5 ) ) / pageDim;
			let maxUv = ( offset + size - vec2f( 0.5 ) ) / pageDim;
			atlasUv = clamp( atlasUv, minUv, maxUv );

			return textureSampleLevel( ${ atlas }, ${ atlasSampler }, atlasUv, page, lod );

		}

	}
`;

