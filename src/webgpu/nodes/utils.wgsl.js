import { wgslFn } from 'three/tsl';
import { vertexAttributesStruct } from './structs.wgsl';

export const getPointAttributes = wgslFn( /* wgsl */ `

	fn getPointAttributes(
		attributes: ptr<storage, array<VertexAttributes>, read>,
		indices: vec3u,
		barycoord: vec3f,
	) -> VertexAttributes {

		let a = attributes[ indices.x ];
		let b = attributes[ indices.y ];
		let c = attributes[ indices.z ];
		let color = a.color * barycoord.x + b.color * barycoord.y + c.color * barycoord.z;
		let normal = a.normal * barycoord.x + b.normal * barycoord.y + c.normal * barycoord.z;
		let uv = a.uv * barycoord.x + b.uv * barycoord.y + c.uv * barycoord.z;
		return VertexAttributes(color, normal, uv);
	}

`, [ vertexAttributesStruct ] );

export const squareFunc = wgslFn( /* wgsl */ `

	fn square( value: f32 ) -> f32 {
		return value * value;
	}

` );

export const squareVecFunc = wgslFn( /* wgsl */ `

	fn squareVec( value: vec3f ) -> vec3f {
		return value * value;
	}

` );

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

		let det = (  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
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

export const saturateCosFunc = wgslFn( /* wgsl */ `
	fn saturateCos( val: f32 ) -> f32 {

		return clamp( val, 0.001, 1.0 );

	}

` );

export const getRefractionHalfVectorFunc = wgslFn( /* wgsl */ `

	fn getRefractionHalfVector( wi: vec3f, wo: vec3f, eta: f32 ) -> vec3f {

		// get the half vector - assuming if the light incident vector is on the other side
		// of the that it's transmissive.
		var h: vec3f;
		if ( wi.z > 0.0 ) {

			h = normalize( wi + wo );

		} else {

			// Scale by the ior ratio to retrieve the appropriate half vector
			// From Section 2.2 on computing the transmission half vector:
			// https://blog.selfshadow.com/publications/s2015-shading-course/burley/s2015_pbs_disney_bsdf_notes.pdf
			h = normalize( wi + wo * eta );

		}

		h *= sign( h.z );
		return h;

	}

` );

export const getHalfVectorFunc = wgslFn( /* wgsl */ `

	fn getHalfVector( a: vec3f, b: vec3f ) -> vec3f {
		return normalize( a + b );
	}

` );
