<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/device](doc/markdown/./device.md) &gt; [PBInsideFunctionScope](doc/markdown/./device.pbinsidefunctionscope.md) &gt; [$while](doc/markdown/./device.pbinsidefunctionscope._while.md)

## PBInsideFunctionScope.$while() method

Creates a 'while' statement

**Signature:**

```typescript
$while(condition: ExpValueNonArrayType, body: (this: PBWhileScope) => void): void;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  condition | [ExpValueNonArrayType](doc/markdown/./device.expvaluenonarraytype.md) | Condition expression for the while statement |
|  body | (this: [PBWhileScope](doc/markdown/./device.pbwhilescope.md)<!-- -->) =&gt; void | Generator function for the scope that inside the while statement |

**Returns:**

void
