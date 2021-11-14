export const shaderMaterialStructs = /* glsl */ `

    struct Material {

        vec3 color;
        int map;

        float metalness;
        int metalnessMap;

        float roughness;
        int roughnessMap;

        float ior;
        float transmission;
        int transmissionMap;

        vec3 emissive;
        float emissiveIntensity;
        int emissiveMap;

    	int normalMap;
		vec2 normalScale;

    };

`;

export const pathTracingHelpers = /* glsl */ `

	vec3 getHemisphereSample( vec3 normal, vec2 uv ) {

		uv = abs( uv );

		// https://www.rorydriscoll.com/2009/01/07/better-sampling/
		vec3 tangent;
		vec3 bitangent;

		if ( abs( normal.x ) > 0.5 ) {

			tangent = vec3( 0.0, 1.0, 0.0 );

		} else {

			tangent = vec3( 1.0, 0.0, 0.0 );

		}

		bitangent = cross( normal, tangent );
		tangent = cross( normal, bitangent );

		float r = sqrt( uv.x );
		float theta = 2.0 * PI * uv.y;
		float x = r * cos( theta );
		float y = r * sin( theta );
		return x * tangent + y * bitangent + sqrt( 1.0 - uv.x ) * normal;

	}

	// https://www.shadertoy.com/view/wltcRS
	uvec4 s0, s1;
	ivec2 pixel;

	void rng_initialize(vec2 p, int frame) {

		pixel = ivec2(p);

		// white noise seed
		s0 = uvec4( p, uint( frame ), uint( p.x ) + uint( p.y ) );

		// blue noise seed
		s1 = uvec4( frame, frame * 15843, frame * 31 + 4566, frame * 2345 + 58585 );
	}

	// https://www.pcg-random.org/
	void pcg4d( inout uvec4 v ) {

		v = v * 1664525u + 1013904223u;
		v.x += v.y * v.w;
		v.y += v.z * v.x;
		v.z += v.x * v.y;
		v.w += v.y * v.z;
		v = v ^ ( v >> 16u );
		v.x += v.y*v.w;
		v.y += v.z*v.x;
		v.z += v.x*v.y;
		v.w += v.y*v.z;

	}

	float rand() {

		pcg4d(s0);
		return float( s0.x ) / float( 0xffffffffu );

	}

	vec2 rand2() {

		pcg4d( s0 );
		return vec2( s0.xy ) / float(0xffffffffu);

	}

	vec3 rand3() {

		pcg4d(s0);
		return vec3( s0.xyz ) / float( 0xffffffffu );

	}

	vec4 rand4() {

		pcg4d(s0);
		return vec4(s0)/float(0xffffffffu);

	}


`;
