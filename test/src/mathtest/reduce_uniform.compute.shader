#pragma kernel sh_0
#pragma kernel sh_1
#pragma kernel sh_2
#pragma kernel sh_3
#pragma kernel sh_4
#pragma kernel sh_5
#pragma kernel sh_6
#pragma kernel sh_7
#pragma kernel sh_8
#pragma kernel Reduce

#include "SH_Utils.cginc"

Texture2DArray<float4>      input_data;
RWStructuredBuffer<float4>  output_buffer;
RWStructuredBuffer<float4>  coefficients;
StructuredBuffer<float4>    input_buffer;

uint ceiled_size;
uint input_size;
uint row_size;
uint face_size;
uint coeff;

struct CS_INPUT
{
	uint3 Gid : SV_GroupID;
	uint3 GTid : SV_GroupThreadID;
	uint3 DTid : SV_DispatchThreadID;
	uint GI : SV_GroupIndex;
};

groupshared float4 groupMem[384];

void first_reduction(CS_INPUT input, uint coefficient)
{
	GroupMemoryBarrierWithGroupSync();

	uint flatGI = input.GI % 64;

	if (flatGI < 32)
		groupMem[input.GI] += groupMem[input.GI + 32];

	GroupMemoryBarrierWithGroupSync();

	if (flatGI < 16)
		groupMem[input.GI] += groupMem[input.GI + 16];

	GroupMemoryBarrierWithGroupSync();

	if (flatGI < 8)
		groupMem[input.GI] += groupMem[input.GI + 8];

	GroupMemoryBarrierWithGroupSync();

	if (flatGI < 4)
		groupMem[input.GI] += groupMem[input.GI + 4];

	GroupMemoryBarrierWithGroupSync();

	if (flatGI < 2)
		groupMem[input.GI] += groupMem[input.GI + 2];

	GroupMemoryBarrierWithGroupSync();

	if (flatGI < 1)
		groupMem[input.GI] += groupMem[input.GI + 1];

	GroupMemoryBarrierWithGroupSync();

	if (flatGI < 1)
	{
		float4 output = groupMem[input.GI];
		uint index = input.Gid.x + input.Gid.y * row_size + input.DTid.z * face_size;
		output_buffer[index] = output;

		if (input.GI == 0 && input_size <= 8)
		{
			float4 output = (groupMem[0] + groupMem[64] + groupMem[128] + groupMem[192] + groupMem[256] + groupMem[320]);
			coefficients[coefficient] = output;
		}
	}
}

[numthreads(8, 8, 6)]
void sh_0(CS_INPUT input)
{
	if (input.DTid.x < input_size && input.DTid.y < input_size)
	{
		float4 loaded = input_data.Load(uint4(input.DTid.x, input.DTid.y, input.DTid.z, 0));
		float2 uv = float2(input.DTid.xy) / (input_size - 1);
		float dw = DifferentialSolidAngle(input_size, uv);
		float3 dir = normalize(RfromUV(input.DTid.z, uv.x, uv.y));
		float sh = Y0(dir);
		groupMem[input.GI] = loaded * dw * sh;
	}
	else
		groupMem[input.GI] = float4(0, 0, 0, 0);

	first_reduction(input, 0);
}

[numthreads(8, 8, 6)]
void sh_1(CS_INPUT input)
{
	if (input.DTid.x < input_size && input.DTid.y < input_size)
	{
		float4 loaded = input_data.Load(uint4(input.DTid.x, input.DTid.y, input.DTid.z, 0));
		float2 uv = float2(input.DTid.xy) / (input_size - 1);
		float dw = DifferentialSolidAngle(input_size, uv);
		float3 dir = normalize(RfromUV(input.DTid.z, uv.x, uv.y));
		float sh = Y1(dir);
		groupMem[input.GI] = loaded * dw * sh;
	}
	else
		groupMem[input.GI] = float4(0, 0, 0, 0);

	first_reduction(input, 1);
}

[numthreads(8, 8, 6)]
void sh_2(CS_INPUT input)
{
	if (input.DTid.x < input_size && input.DTid.y < input_size)
	{
		float4 loaded = input_data.Load(uint4(input.DTid.x, input.DTid.y, input.DTid.z, 0));
		float2 uv = float2(input.DTid.xy) / (input_size - 1);
		float dw = DifferentialSolidAngle(input_size, uv);
		float3 dir = normalize(RfromUV(input.DTid.z, uv.x, uv.y));
		float sh = Y2(dir);
		groupMem[input.GI] = loaded * dw * sh;
	}
	else
		groupMem[input.GI] = float4(0, 0, 0, 0);

	first_reduction(input, 2);
}

[numthreads(8, 8, 6)]
void sh_3(CS_INPUT input)
{
	if (input.DTid.x < input_size && input.DTid.y < input_size)
	{
		float4 loaded = input_data.Load(uint4(input.DTid.x, input.DTid.y, input.DTid.z, 0));
		float2 uv = float2(input.DTid.xy) / (input_size - 1);
		float dw = DifferentialSolidAngle(input_size, uv);
		float3 dir = normalize(RfromUV(input.DTid.z, uv.x, uv.y));
		float sh = Y3(dir);
		groupMem[input.GI] = loaded * dw * sh;
	}
	else
		groupMem[input.GI] = float4(0, 0, 0, 0);

	first_reduction(input, 3);
}

[numthreads(8, 8, 6)]
void sh_4(CS_INPUT input)
{
	if (input.DTid.x < input_size && input.DTid.y < input_size)
	{
		float4 loaded = input_data.Load(uint4(input.DTid.x, input.DTid.y, input.DTid.z, 0));
		float2 uv = float2(input.DTid.xy) / (input_size - 1);
		float dw = DifferentialSolidAngle(input_size, uv);
		float3 dir = normalize(RfromUV(input.DTid.z, uv.x, uv.y));
		float sh = Y4(dir);
		groupMem[input.GI] = loaded * dw * sh;
	}
	else
		groupMem[input.GI] = float4(0, 0, 0, 0);

	first_reduction(input, 4);
}

[numthreads(8, 8, 6)]
void sh_5(CS_INPUT input)
{
	if (input.DTid.x < input_size && input.DTid.y < input_size)
	{
		float4 loaded = input_data.Load(uint4(input.DTid.x, input.DTid.y, input.DTid.z, 0));
		float2 uv = float2(input.DTid.xy) / (input_size - 1);
		float dw = DifferentialSolidAngle(input_size, uv);
		float3 dir = normalize(RfromUV(input.DTid.z, uv.x, uv.y));
		float sh = Y5(dir);
		groupMem[input.GI] = loaded * dw * sh;
	}
	else
		groupMem[input.GI] = float4(0, 0, 0, 0);

	first_reduction(input, 5);
}

[numthreads(8, 8, 6)]
void sh_6(CS_INPUT input)
{
	if (input.DTid.x < input_size && input.DTid.y < input_size)
	{
		float4 loaded = input_data.Load(uint4(input.DTid.x, input.DTid.y, input.DTid.z, 0));
		float2 uv = float2(input.DTid.xy) / (input_size - 1);
		float dw = DifferentialSolidAngle(input_size, uv);
		float3 dir = normalize(RfromUV(input.DTid.z, uv.x, uv.y));
		float sh = Y6(dir);
		groupMem[input.GI] = loaded * dw * sh;
	}
	else
		groupMem[input.GI] = float4(0, 0, 0, 0);

	first_reduction(input, 6);
}

[numthreads(8, 8, 6)]
void sh_7(CS_INPUT input)
{
	if (input.DTid.x < input_size && input.DTid.y < input_size)
	{
		float4 loaded = input_data.Load(uint4(input.DTid.x, input.DTid.y, input.DTid.z, 0));
		float2 uv = float2(input.DTid.xy) / (input_size - 1);
		float dw = DifferentialSolidAngle(input_size, uv);
		float3 dir = normalize(RfromUV(input.DTid.z, uv.x, uv.y));
		float sh = Y7(dir);
		groupMem[input.GI] = loaded * dw * sh;
	}
	else
		groupMem[input.GI] = float4(0, 0, 0, 0);

	first_reduction(input, 7);
}

[numthreads(8, 8, 6)]
void sh_8(CS_INPUT input)
{
	if (input.DTid.x < input_size && input.DTid.y < input_size)
	{
		float4 loaded = input_data.Load(uint4(input.DTid.x, input.DTid.y, input.DTid.z, 0));
		float2 uv = float2(input.DTid.xy) / (input_size - 1);
		float dw = DifferentialSolidAngle(input_size, uv);
		float3 dir = normalize(RfromUV(input.DTid.z, uv.x, uv.y));
		float sh = Y8(dir);
		groupMem[input.GI] = loaded * dw * sh;
	}
	else
		groupMem[input.GI] = float4(0, 0, 0, 0);

	first_reduction(input, 8);
}

[numthreads(8, 8, 6)]
void Reduce(CS_INPUT input)
{
	if (input.DTid.x < input_size && input.DTid.y < input_size)
	{
		uint index = input.DTid.x + input.DTid.y * row_size + input.DTid.z * face_size;
		float4 v = input_buffer[index];
		groupMem[input.GI] = v;
	}
	else
		groupMem[input.GI] = float4(0, 0, 0, 0);
	GroupMemoryBarrierWithGroupSync();

	uint flatGI = input.GI % 64;

	if (flatGI < 32)
		groupMem[input.GI] += groupMem[input.GI + 32];

	GroupMemoryBarrierWithGroupSync();

	if (flatGI < 16)
		groupMem[input.GI] += groupMem[input.GI + 16];

	GroupMemoryBarrierWithGroupSync();

	if (flatGI < 8)
		groupMem[input.GI] += groupMem[input.GI + 8];

	GroupMemoryBarrierWithGroupSync();

	if (flatGI < 4)
		groupMem[input.GI] += groupMem[input.GI + 4];

	GroupMemoryBarrierWithGroupSync();

	if (flatGI < 2)
		groupMem[input.GI] += groupMem[input.GI + 2];

	GroupMemoryBarrierWithGroupSync();

	if (flatGI < 1)
		groupMem[input.GI] += groupMem[input.GI + 1];

	GroupMemoryBarrierWithGroupSync();

	if (flatGI < 1)
	{
		float4 output = groupMem[input.GI];
		uint index = input.Gid.x + input.Gid.y * row_size + input.DTid.z * face_size;
		output_buffer[index] = output;

		if (input.GI == 0 && input_size <= 8)
		{
			float4 output = (groupMem[0] + groupMem[64] + groupMem[128] + groupMem[192] + groupMem[256] + groupMem[320]);
			coefficients[coeff] = output;
		}
	}
}
