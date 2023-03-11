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

		bool firstRay;
		bool transmissiveRay;
		bool isShadowRay;
		float accumulatedRoughness;
		int transmissiveTraversals;
		vec3 throughputColor;

	}

	RenderState initRenderState() {

		RenderState result;
		result.firstRay = true;
		result.transmissiveRay = false;
		result.isShadowRay = false;
		result.accumulatedRoughness = 0.0;
		result.transmissiveTraversals = 0;
		result.throughputColor = vec3( 1.0 );

	}

`;
