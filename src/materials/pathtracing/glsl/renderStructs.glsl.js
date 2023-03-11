export const renderStructsGLSL = /* glsl */`

	struct Ray {

		vec3 origin;
		vec3 direction;

	}

	struct GeometryHit {

		uvec4 faceIndices;
		vec3 barycoord;
		vec3 faceNormal;
		float side;
		float dist;

	}

	struct RenderState {

		bool transmissiveRay;
		bool isShadowRay;
		float accumulatedRoughness;
		int transmissiveTraversals;
		vec3 throughputColor;

	}


`;
