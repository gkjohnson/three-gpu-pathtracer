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

		float opacity;

    };

`;

export const pathTracingHelpers = /* glsl */ `

	vec3 getHemisphereSample( vec3 n, vec2 uv ) {

		// https://www.rorydriscoll.com/2009/01/07/better-sampling/
		// https://graphics.pixar.com/library/OrthonormalB/paper.pdf
		float sign = n.z == 0.0 ? 1.0 : sign( n.z );
		float a = - 1.0 / ( sign + n.z );
		float b = n.x * n.y * a;
		vec3 b1 = vec3( 1.0 + sign * n.x * n.x * a, sign * b, - sign * n.x );
		vec3 b2 = vec3( b, sign + n.y * n.y * a, - n.y );

		float r = sqrt( uv.x );
		float theta = 2.0 * PI * uv.y;
		float x = r * cos( theta );
		float y = r * sin( theta );
		return x * b1 + y * b2 + sqrt( 1.0 - uv.x ) * n;

	}

	// https://www.shadertoy.com/view/wltcRS
	uvec4 s0;

	void rng_initialize(vec2 p, int frame) {

		// white noise seed
		s0 = uvec4( p, uint( frame ), uint( p.x ) + uint( p.y ) );

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
